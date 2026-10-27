import { revalidatePath, revalidateTag } from 'next/cache'

export function POST(request) {
  const params = new URL(request.url).searchParams
  const tag = params.get('tag')
  if (tag) {
    revalidateTag(tag, 'max')
    return Response.json({ revalidated: `tag:${tag}` })
  }
  const path = params.get('path') ?? '/'
  revalidatePath(path)
  return Response.json({ revalidated: path })
}
