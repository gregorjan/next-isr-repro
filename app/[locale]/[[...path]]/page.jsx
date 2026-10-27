import { Catalog } from './catalog'

export function generateStaticParams() {
  return [
    { locale: 'en', path: [] },
    { locale: 'de', path: [] },
  ]
}

export default async function Page({ params }) {
  const { locale, path = [] } = await params
  return <Catalog locale={locale} path={path} />
}
