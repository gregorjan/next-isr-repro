import { cacheLife, cacheTag } from 'next/cache'

export async function Catalog({ locale, path }) {
  'use cache'
  cacheLife('max')
  cacheTag('catalog', `catalog_${locale}`)
  return (
    <main>
      <h1>Catalogue page</h1>
      <p>Fixed output: {[locale, ...path].join('/')}</p>
    </main>
  )
}
