import { cacheLife, cacheTag } from 'next/cache'

async function navigation() {
  'use cache'
  cacheLife('max')
  cacheTag('navigation')
  return {
    items: [
      { label: 'Home', href: '/' },
      { label: 'Example', href: '/example' },
    ],
  }
}

export async function GET() {
  return Response.json(await navigation())
}
