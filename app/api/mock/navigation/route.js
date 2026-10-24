export const dynamic = 'force-static'
export const revalidate = 2

export function GET() {
  return Response.json({
    items: [
      { label: 'Home', href: '/' },
      { label: 'Example', href: '/example' },
    ],
  })
}
