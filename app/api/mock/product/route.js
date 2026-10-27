import { cacheLife, cacheTag } from 'next/cache'

async function product() {
  'use cache'
  cacheLife('max')
  cacheTag('product')
  return {
    id: 'mock-001',
    title: 'Mock product',
    price: { amount: 100, currency: 'EUR' },
    attributes: [{ name: 'finish', value: 'chrome' }],
  }
}

export async function GET() {
  return Response.json(await product())
}
