import { revalidatePath } from 'next/cache'

export function POST(request) {
  const path = new URL(request.url).searchParams.get('path') ?? '/'
  revalidatePath(path)
  return Response.json({ revalidated: path })
}
