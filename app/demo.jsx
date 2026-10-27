import { cacheLife, cacheTag } from 'next/cache'

export async function Demo() {
  'use cache'
  cacheLife('max')
  cacheTag('demo')
  return <p>Fixed output: baseline-v1</p>
}
