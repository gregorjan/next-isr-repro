import { createHash } from 'node:crypto'

// Usage: bun run tools/ondemand.ts [base URL] [rounds] [interval seconds]
// Warms the outputs, waits one interval, then revalidates `/` and the mock product API once per interval.
const base = (process.argv[2] || 'http://127.0.0.1:3199').replace(/\/$/, '')
const rounds = Number(process.argv[3] || 5)
const interval = Number(process.argv[4] || 60) * 1000
const targets = {
  html: { path: '/', headers: {} },
  rsc: { path: '/', headers: { RSC: '1' } },
  api: { path: '/api/mock/product', headers: {} },
} as const
type Name = keyof typeof targets

const sample = async (name: Name) => {
  const { path, headers } = targets[name]
  const response = await fetch(base + path, { headers, cache: 'no-store' })
  const body = Buffer.from(await response.arrayBuffer())
  const header = (key: string) => response.headers.get(key) ?? '-'
  return {
    name,
    status: response.status,
    cache: `${header('x-vercel-cache')}/${header('x-nextjs-cache')}`,
    age: header('age'),
    etag: header('etag'),
    length: header('content-length'),
    bytes: body.length,
    sha: createHash('sha256').update(body).digest('hex').slice(0, 12),
  }
}
type Sample = Awaited<ReturnType<typeof sample>>

const reference = new Map<Name, Sample>()
const print = (label: string, s: Sample) => {
  const first = reference.get(s.name)
  const same = first ? (first.sha === s.sha && first.etag === s.etag ? 'same' : 'CHANGED') : 'ref'
  console.log(
    [new Date().toISOString(), label.padEnd(10), s.name.padEnd(4), s.status, `cache=${s.cache}`, `age=${s.age}`,
      `etag=${s.etag}`, `content-length=${s.length}`, `bytes=${s.bytes}`, `sha=${s.sha}`, same].join(' '),
  )
}
const revalidate = async (path: string) => {
  const response = await fetch(`${base}/api/revalidate?path=${encodeURIComponent(path)}`, { method: 'POST' })
  console.log(new Date().toISOString(), 'revalidate', path, response.status, await response.text())
  if (!response.ok) throw Error(`Revalidate ${path} failed`)
}
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

console.log(`base=${base} rounds=${rounds} interval=${interval / 1000}s`)
for (const name of Object.keys(targets) as Name[]) {
  for (let i = 0; i < 2; i++) {
    const s = await sample(name)
    if (!reference.has(name)) reference.set(name, s)
    print('warm', s)
  }
}

let changed = 0
for (let round = 1; round <= rounds; round++) {
  console.log(`-- cooldown ${interval / 1000}s`)
  await sleep(interval)
  for (const name of Object.keys(targets) as Name[]) print(`r${round} before`, await sample(name))
  await revalidate('/')
  await revalidate('/api/mock/product')
  for (const label of ['after', 'after2']) {
    for (const name of Object.keys(targets) as Name[]) {
      const s = await sample(name)
      const first = reference.get(name)!
      if (first.sha !== s.sha || first.etag !== s.etag) changed++
      print(`r${round} ${label}`, s)
    }
    await sleep(1000)
  }
}
console.log(changed ? `${changed} samples differed from the warm reference` : 'All samples matched the warm reference')
