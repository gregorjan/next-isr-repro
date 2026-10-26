export const dynamic = 'force-static'
export const revalidate = false

export function GET() {
  return Response.json({
    items: [
      { label: 'Home', href: '/' },
      { label: 'Example', href: '/example' },
    ],
  })
}
