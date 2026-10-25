# Minimal Next.js ISR reproduction

Diagnostic-only Next.js 16.2.9 with the Buffer/ETag dependency patch, React 19.2.3 and Node.js 22.23.2. No CMS, middleware, fonts, styling, authentication or application libraries.

This branch applies the Buffer/ETag experiment from `bugfix/repro-canary-buffer-pages` to the GROHE Next.js version. It starts from `bugfix/repro-pages-router` and changes only `package.json`, the lockfile and `patches/next@16.2.9.patch`; unlike `bugfix/repro-canary-buffer-pages`, `getStaticProps` stays `async`, so the page source is identical to the stock 16.2.9 Pages control. The patch file is byte-identical to the canary patch because both sender files are unchanged between 16.2.9 and 16.5.0-canary.26.

This is a diagnostic control, not a proposed dependency-patched application fix. The unpatched 16.2.9 Pages control remains on `bugfix/repro-pages-router`; the recorded stock comparisons below do not describe this patched branch. `pnpm trace` refuses patched Next.js builds by design and targets the App Router.

Local `next start` comparison with `bugfix/repro-pages-router`, three natural expiries each: stock serves the cached 31-byte data JSON (`/_next/data/<buildId>/index.json`) chunked, without ETag or Content-Length; the patched build serves the same bytes with an ETag and Content-Length. HTML has an ETag in both. Data bytes were stable across regenerations in both builds.

The first runtime regeneration after a build adds `"isExperimentalCompile":false` to `__NEXT_DATA__` (1225 → 1255 bytes); later regenerations are byte-stable. Stock 15.5.28 and 16.5.0-canary.26 show the same first-regeneration difference, so it does not explain why only 16.2.9 measured +1 on Pages, but a measured regeneration must not be the first after a deploy.

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

`tools/trace.ts` starts the production server with Node's debugger bound to an ephemeral loopback port. It places debugger breakpoints in the compiled sender and on the actual `RenderResult.fromStatic` methods. It reads arguments and response types; it does not edit dependencies, replace functions or change response bytes.

The client requests HTML, full RSC and mock JSON, waits for natural ISR expiry, then requests the regenerated output. It records factory inputs, sender inputs, cache headers, ETags and response hashes. Evidence is written to a temporary directory outside the repository. The server is stopped and port 3199 released afterwards.

If the executable named `node` is not Node.js 22, set `REPRO_NODE` to the desired Node executable when running the trace. The observed Node version is included in the result.

### Established baseline behavior (stock Next.js 16.2.9)

On the fixed page, cached HTML reaches the sender as a string with `RenderResult.isDynamic === false`. Cached RSC reaches it as a Buffer with `RenderResult.isDynamic === true`. The RSC Buffer is already present at the input to `fromStatic`; that method is not converting an HTML string into a Buffer.

This behavior occurs before mocked data is connected. `RenderResult.isDynamic` describes an internal response representation, not whether the route is ISR-cacheable. These observations do not establish the cause of Vercel ISR write charges.

### Hosted HTML-only check

An HTML-only visit to the unchanged static page reproduced ISR writes on Vercel. The page returned `STALE`, then `HIT` after regeneration, with identical HTML SHA-256 and ETag. The project's Usage dashboard increased from 13 to 19 ISR write units and from two to three function invocations. The test made no explicit RSC or mock-API requests; the page itself fetches no data.

This demonstrates writes associated with regenerating unchanged captured HTML in the bare application. It does not prove that every internal artifact or header is unchanged, or that `RenderResult.isDynamic` causes the writes. The Usage dashboard is available on the Hobby plan; the separate `vercel metrics` query requires paid Observability Plus and was not enabled.

## Incremental experiments

Keep the baseline commit. Add exactly one mocked behavior per commit and rerun the same URL and trace: asynchronous data, asynchronous sibling components, null-returning components, a mocked component map, then dynamic routing. Keep mock responses fixed so output changes can be separated from scheduling changes. Do not import real application code or add dependency patches.

## Vercel

Project: `next-isr-repro` in the personal `jangregor-actumdigitals-projects` scope. Local project linkage is ignored by Git. No paid features are required or enabled by this repository. Local debugger observations and Vercel write metering are separate checks.
