export const dynamic = 'force-static'
export const revalidate = 2

export function GET() {
  return Response.json({
    id: 'mock-001',
    title: 'Mock product',
    price: { amount: 100, currency: 'EUR' },
    attributes: [{ name: 'finish', value: 'chrome' }],
  })
}
