import { createHash } from 'node:crypto'
import { closeSync, mkdtempSync, openSync, realpathSync, writeSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const require = createRequire(join(root, 'package.json'))
if (realpathSync(require.resolve('next/package.json')).includes('patch_hash')) throw Error('Refusing patched Next.js')
const node = process.env.REPRO_NODE || 'node'
const port = 3199
const output = mkdtempSync(join(tmpdir(), 'next-isr-repro-'))
const serverLog = openSync(join(output, 'server.log'), 'w')
const eventsLog = openSync(join(output, 'events.jsonl'), 'w')
const listener = () => Bun.spawnSync(['lsof', '-t', `-iTCP:${port}`, '-sTCP:LISTEN']).stdout.toString().trim()
if (listener()) throw Error(`Port ${port} is occupied`)

const files = new Set<string>([
  realpathSync(require.resolve('next/dist/server/send-payload.js')),
])
for await (const path of new Bun.Glob('.next/server/**/*.js').scan({ cwd: root })) files.add(join(root, path))
const sites: { path: string; line: number; column: number; result: string; request: string }[] = []
for (const path of files) {
  const text = await Bun.file(path).text()
  for (const match of text.matchAll(/\b([\w$]+)\.isDynamic\s*\?\s*null\s*:/g)) {
    const index = match.index!
    const prefix = text.slice(0, index)
    const near = text.slice(Math.max(0, index - 1400), index)
    const aliases = [...near.matchAll(/\breq\s*:\s*([\w$]+)/g)]
    sites.push({
      path,
      line: prefix.split('\n').length - 1,
      column: index - prefix.lastIndexOf('\n') - 1,
      result: match[1],
      request: aliases.at(-1)?.[1] || 'req',
    })
  }
}
if (!sites.length) throw Error('No stock sendRenderResult location found; build first')

const child = Bun.spawn([
  node, '--inspect-brk=127.0.0.1:0', require.resolve('next/dist/bin/next'),
  'start', '--hostname', '127.0.0.1', '--port', String(port),
], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
let resolveInspector: (url: string) => void
const inspectorReady = new Promise<string>((resolve) => { resolveInspector = resolve })
const pump = async (stream: ReadableStream<Uint8Array>) => {
  let pending = ''
  for await (const chunk of stream) {
    writeSync(serverLog, chunk)
    pending += new TextDecoder().decode(chunk)
    const found = pending.match(/ws:\/\/127\.0\.0\.1:\d+\/[\w-]+/)
    if (found) resolveInspector(found[0])
    if (pending.length > 20000) pending = pending.slice(-10000)
  }
}
const pumps = [pump(child.stdout), pump(child.stderr)]
let socket: WebSocket | undefined
let phase = 'startup'
let sequence = 0
const calls = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
const breakpoints = new Map<string, typeof sites[number]>()
const factoryBreakpoints = new Set<string>()
const factoryObserved = new Set<string>()
let nodeVersion: string | undefined
const pauseTasks = new Set<Promise<void>>()
const observations: Record<string, unknown>[] = []
const responses: Record<string, unknown>[] = []
const send = (method: string, params: object = {}) => new Promise<any>((resolve, reject) => {
  const id = ++sequence
  const timer = setTimeout(() => { calls.delete(id); reject(Error(`Inspector timeout: ${method}`)) }, 10000)
  calls.set(id, { resolve, reject, timer })
  socket!.send(JSON.stringify({ id, method, params }))
})
const paused = async (params: any) => {
  try {
    const factory = params.hitBreakpoints?.some((id: string) => factoryBreakpoints.has(id))
    if (factory) {
      const evaluated = await send('Debugger.evaluateOnCallFrame', {
        callFrameId: params.callFrames[0].callFrameId,
        expression: `({ inputKind: Buffer.isBuffer(arguments[0]) ? 'buffer' : typeof arguments[0], contentType: arguments[1], bytes: Buffer.isBuffer(arguments[0]) ? arguments[0].length : typeof arguments[0] === 'string' ? Buffer.byteLength(arguments[0]) : null })`,
        returnByValue: true,
        silent: true,
      })
      if (evaluated.exceptionDetails) throw Error(evaluated.exceptionDetails.text)
      const event = { event: 'from-static-input', phase, ...evaluated.result.value }
      observations.push(event)
      writeSync(eventsLog, `${JSON.stringify(event)}\n`)
      console.log(JSON.stringify(event))
      return
    }
    const site = params.hitBreakpoints?.map((id: string) => breakpoints.get(id)).find(Boolean)
    if (!site) return
    const value = site.result
    const factoryKey = (await send('Debugger.evaluateOnCallFrame', {
      callFrameId: params.callFrames[0].callFrameId,
      expression: `${value}.contentType`,
      returnByValue: true,
      silent: true,
    })).result.value
    if (!factoryObserved.has(factoryKey)) {
      const method = await send('Debugger.evaluateOnCallFrame', {
        callFrameId: params.callFrames[0].callFrameId,
        expression: `${value}.constructor.fromStatic`,
        silent: true,
      })
      if (method.result?.objectId && method.result.type === 'function') {
        const breakpoint = await send('Debugger.setBreakpointOnFunctionCall', { objectId: method.result.objectId })
        factoryBreakpoints.add(breakpoint.breakpointId)
        factoryObserved.add(factoryKey)
      }
    }
    const expression = `({ path: typeof ${site.request} === 'undefined' ? null : ${site.request}.url, contentType: ${value}.contentType, responseKind: Buffer.isBuffer(${value}.response) ? 'buffer' : Array.isArray(${value}.response) ? 'array' : ${value}.response === null ? 'null' : typeof ${value}.response, resultIsDynamic: ${value}.isDynamic, bytes: Buffer.isBuffer(${value}.response) ? ${value}.response.length : typeof ${value}.response === 'string' ? Buffer.byteLength(${value}.response) : null })`
    const evaluated = await send('Debugger.evaluateOnCallFrame', {
      callFrameId: params.callFrames[0].callFrameId,
      expression,
      returnByValue: true,
      silent: true,
    })
    if (evaluated.exceptionDetails) throw Error(evaluated.exceptionDetails.text)
    const event = { event: 'sender-input', phase, source: relative(root, site.path), ...evaluated.result.value }
    observations.push(event)
    writeSync(eventsLog, `${JSON.stringify(event)}\n`)
    console.log(JSON.stringify(event))
  } finally {
    await send('Debugger.resume')
  }
}

try {
  const inspectorUrl = await Promise.race([
    inspectorReady,
    Bun.sleep(15000).then(() => { throw Error('Inspector did not start') }),
  ])
  socket = new WebSocket(inspectorUrl)
  await new Promise<void>((resolve, reject) => {
    socket!.addEventListener('open', () => resolve(), { once: true })
    socket!.addEventListener('error', () => reject(Error('Inspector connection failed')), { once: true })
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (message.id) {
      const call = calls.get(message.id)
      if (!call) return
      clearTimeout(call.timer)
      calls.delete(message.id)
      if (message.error) call.reject(Error(message.error.message))
      else call.resolve(message.result)
    } else if (message.method === 'Debugger.paused') {
      const task = paused(message.params)
      pauseTasks.add(task)
      task.catch((error) => console.error(String(error))).finally(() => pauseTasks.delete(task))
    }
  })
  await send('Debugger.enable')
  nodeVersion = (await send('Runtime.evaluate', { expression: 'process.version', returnByValue: true })).result.value
  for (const site of sites) {
    const result = await send('Debugger.setBreakpointByUrl', {
      urlRegex: site.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$',
      lineNumber: site.line,
      columnNumber: site.column,
    })
    breakpoints.set(result.breakpointId, site)
  }
  await send('Runtime.runIfWaitingForDebugger')
  const base = `http://127.0.0.1:${port}`
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw Error('Next.js server exited')
    try {
      const response = await fetch(`${base}/api/mock/product`, { signal: AbortSignal.timeout(1000) })
      await response.arrayBuffer()
      if (response.ok) { ready = true; break }
    } catch {}
    await Bun.sleep(100)
  }
  if (!ready) throw Error('Next.js server did not become ready')
  const request = async (label: string, path: string, rsc = false) => {
    phase = label
    const response = await fetch(base + path + (rsc ? '?_rsc=' : ''), {
      headers: { 'accept-encoding': 'identity', ...(rsc ? { rsc: '1' } : {}) },
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
    })
    const bytes = Buffer.from(await response.arrayBuffer())
    const event = {
      event: 'response', phase, path, status: response.status,
      contentType: response.headers.get('content-type'),
      cache: response.headers.get('x-nextjs-cache'), etag: response.headers.get('etag'),
      bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    }
    responses.push(event)
    writeSync(eventsLog, `${JSON.stringify(event)}\n`)
    console.log(JSON.stringify(event))
    if (response.status !== 200) throw Error(`Unexpected response: ${response.status}`)
    if (rsc && !event.contentType?.includes('text/x-component')) throw Error('Not a Flight response')
    return event
  }
  await request('initial-html', '/')
  await request('initial-rsc', '/', true)
  await request('mock-json', '/api/mock/navigation')
  await Bun.sleep(2300)
  await request('expired-html', '/')
  await Bun.sleep(500)
  await request('settled-html', '/')
  await request('settled-rsc', '/', true)
  await Promise.all([...pauseTasks])
  const htmlString = observations.some((row) => row.responseKind === 'string' && row.resultIsDynamic === false)
  const rscBuffer = observations.some((row) => row.responseKind === 'buffer' && row.resultIsDynamic === true && String(row.contentType).includes('text/x-component'))
  const factoryBuffer = observations.some((row) => row.event === 'from-static-input' && row.inputKind === 'buffer')
  const result = { nodeVersion, next: require('next/package.json').version, observations: observations.length, htmlString, rscBuffer, factoryBuffer, output }
  await Bun.write(join(output, 'result.json'), JSON.stringify({ ...result, observations, responses }, null, 2))
  console.log(JSON.stringify({ event: 'complete', ...result }))
  if (!htmlString || !rscBuffer || !factoryBuffer) throw Error('Expected sender/factory values were not observed; inspect evidence')
} finally {
  socket?.close()
  for (const call of calls.values()) { clearTimeout(call.timer); call.reject(Error('Inspector stopped')) }
  calls.clear()
  child.kill()
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000)
  await child.exited
  clearTimeout(timeout)
  await Promise.all(pumps)
  closeSync(serverLog)
  closeSync(eventsLog)
  if (listener()) throw Error(`Port ${port} was not released`)
}
