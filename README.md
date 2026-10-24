# Minimal Next.js ISR reproduction

Stock Next.js 15.5.28, React 19.2.3 and Node.js 22.23.2. No dependency patches, CMS, middleware, fonts, styling, authentication or application libraries.

This branch tests the latest stable Next.js 15 release available when the comparison started using the Pages Router. The fixed page moves to `pages/index.jsx` and uses `getStaticProps` with `revalidate: 2`; content and default ETag behavior are retained. The local debugger client targets the App Router baseline, not this Pages Router control.

## Baseline

- `/`: fixed static page with a two-second ISR lifetime.
- `/api/mock/product`: fixed mock product JSON.
- `/api/mock/navigation`: fixed mock navigation JSON.

The page does not call either mock API. This is the control before connecting asynchronous data or other mocked application features.

## Run

Use Node.js 22 and pnpm 10. Bun is required only for the local debugger client.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

The local application listens on `127.0.0.1:3199`. Port 3100 is not used.

## Observe actual renderer values

Stop any manually started server before running:

```sh
pnpm trace
```

`tools/trace.ts` starts the production server with Node's debugger bound to an ephemeral loopback port. It places debugger breakpoints in the compiled stock sender and on the actual `RenderResult.fromStatic` methods. It reads arguments and response types; it does not edit dependencies, replace functions or change response bytes.

The client requests HTML, full RSC and mock JSON, waits for natural ISR expiry, then requests the regenerated output. It records factory inputs, sender inputs, cache headers, ETags and response hashes. Evidence is written to a temporary directory outside the repository. The server is stopped and port 3199 released afterwards.

If the executable named `node` is not Node.js 22, set `REPRO_NODE` to the desired Node executable when running the trace. The observed Node version is included in the result.

### Established baseline behavior (Next.js 16.2.9)

On the fixed page, cached HTML reaches the sender as a string with `RenderResult.isDynamic === false`. Cached RSC reaches it as a Buffer with `RenderResult.isDynamic === true`. The RSC Buffer is already present at the input to `fromStatic`; that method is not converting an HTML string into a Buffer.

This behavior occurs before mocked data is connected. `RenderResult.isDynamic` describes an internal response representation, not whether the route is ISR-cacheable. These observations do not establish the cause of Vercel ISR write charges.

### Vercel comparison: Next.js 16.2.9, default settings

All controls use default ETag behavior, React 19.2.3, Node.js 22.23.2 and two-second natural ISR expiry. No dependency patches or framework configuration overrides are present. Each measured request returned `STALE`, then settled to `HIT`; response SHA-256 and ETag stayed identical. Cases were measured sequentially against the isolated project's Usage dashboard after warming and allowing usage ingestion to settle.

| Control | Branch | ISR writes before → after | Function invocations before → after | Additional write units |
| --- | --- | --- | --- | --- |
| Fixed JSON API | `bugfix/isr-repro` | 64 → 64 | 17 → 18 | **0** |
| Pages Router static page | `bugfix/repro-pages-router` | 64 → 65 | 18 → 19 | **1** |
| App Router static page | `bugfix/isr-repro` | 65 → 71 | 19 → 20 | **6** |

The page tests issue HTML requests only; neither page fetches an API. Separate artifact inspection found identical payloads for App Router HTML, full RSC and all five advertised segments (`/_tree`, `/_full`, `/__PAGE__`, `/_index`, `/_head`) across regeneration. Only visible `Date`, `Age` and request-ID headers differed. The Pages Router's 31-byte data JSON was also sampled unchanged, without an ETag. The fixed JSON API has an ETag and incurred no additional write units even though its `Date` header changed.

These controls reproduce writes associated with page-data outputs without application features. They do not establish the private persistence implementation or prove that `RenderResult.isDynamic` causes the writes. The Usage dashboard is available on the Hobby plan; the separate `vercel metrics` query requires paid Observability Plus and was not enabled. The separate ETag-disabled experiment is excluded from this comparison.

### Latest-canary comparison: Next.js 16.5.0-canary.26

The npm `canary` tag resolved to **16.5.0-canary.26** when this comparison started. The same controls retain React 19.2.3, Node.js 22.23.2, fixed content, two-second natural ISR expiry and default ETags. Each measured case had exactly one additional function invocation, `STALE` followed by `HIT`, and unchanged captured response SHA-256 and ETag.

| Control | Branch | ISR writes before → after | Function invocations before → after | Additional write units |
| --- | --- | --- | --- | --- |
| Fixed JSON API | `bugfix/repro-canary-app` | 82 → 82 | 25 → 26 | **0** |
| Pages Router static page | `bugfix/repro-canary-pages` | 82 → 82 | 26 → 27 | **0** |
| App Router static page | `bugfix/repro-canary-app` | 82 → 86 | 27 → 28 | **4** |

| Next.js variant | API | Pages Router | App Router |
| --- | --- | --- | --- |
| Stock 15.5.28 | +0 | +0 | +1 |
| Stock 16.2.9 | +0 | +1 | +6 |
| Stock 16.5.0-canary.26 | +0 | +0 | +4 |
| 16.5.0-canary.26 with diagnostic Buffer/ETag patch | +0 | +0 | +0 |

Values are additional ISR write units for an isolated measured regeneration, not total requests or artifact counts. Each case has exactly one additional function invocation, unchanged captured response SHA-256 and ETag, and `STALE` followed by `HIT`. All stock rows are dependency-patch-free. Vercel deployments use Node.js 22.x; local builds use 22.23.2.

### Additional controls: latest Next.js 15 and patched canary

The latest stable 15.x release resolved to **15.5.28**; the canary tag still resolved to **16.5.0-canary.26**. React 19.2.3, fixed content, two-second ISR and the default `generateEtags` setting are retained. Tests use the same isolated Vercel project and are measured sequentially through its Usage dashboard, including a second ingestion check before accepting the result.

| Control | Branch | ISR writes before → after | Function invocations before → after |
| --- | --- | --- | --- |
| Next.js 15 fixed JSON API | `bugfix/repro-next15-app` | 98 → 98 | 38 → 39 |
| Next.js 15 Pages Router | `bugfix/repro-next15-pages` | 98 → 98 | 39 → 40 |
| Next.js 15 App Router | `bugfix/repro-next15-app` | 98 → 99 | 40 → 41 |
| Patched canary fixed JSON API | `bugfix/repro-canary-buffer-app` | 99 → 99 | 41 → 42 |
| Patched canary App Router | `bugfix/repro-canary-buffer-app` | 99 → 99 | 42 → 43 |
| Patched canary Pages Router | `bugfix/repro-canary-buffer-pages` | 99 → 99 | 43 → 44 |

Unchanged-output App Router writes also occur on the latest 15.x release, so the behavior is not exclusive to Next.js 16. This is not a bisect and does not identify the earliest affected release or establish why write-unit counts differ between versions.

The patched canary is an explicitly authorized diagnostic experiment, not an application delivery candidate. Its [patch](https://github.com/gregorjan/next-isr-repro/blob/bugfix/repro-canary-buffer-app/patches/next%4016.5.0-canary.26.patch) changes only the CJS and ESM senders: already-existing Buffers are sent directly and hashed through their Latin-1 representation for ETags, enabling the existing Content-Length and conditional-response paths. Response bytes and genuine stream handling are unchanged. Cached RSC on this deployment has an ETag. The zero-write result is diagnostic evidence; it does not isolate which changed behavior matters or prove Vercel's private persistence mechanism.

## Incremental experiments

Keep the baseline commit. Add exactly one mocked behavior per commit and rerun the same URL and trace: asynchronous data, asynchronous sibling components, null-returning components, a mocked component map, then dynamic routing. Keep mock responses fixed so output changes can be separated from scheduling changes. Do not import real application code or add dependency patches.

## Vercel

Project: `next-isr-repro` in the personal `jangregor-actumdigitals-projects` scope. Local project linkage is ignored by Git. No paid features are required or enabled by this repository. Local debugger observations and Vercel write metering are separate checks.
