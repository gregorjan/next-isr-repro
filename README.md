# Minimal Next.js ISR reproduction

Stock Next.js 16.2.9, React 19.2.3 and Node.js 22.23.2. No dependency patches, CMS, middleware, fonts, styling, authentication or application libraries.

This on-demand control matches GROHE production: `revalidate = false` and regeneration only through `revalidatePath`, the call GROHE's `/api/revalidate` uses for paths. It changes only the revalidation trigger from `bugfix/isr-repro`; content, default ETags (`generateEtags: true`, no `next.config`) and versions are unchanged. The recorded tables below were measured with two-second time-based ISR, not with this branch.

## Baseline

- `/`: fixed static page, `revalidate = false`.
- `/api/mock/product`: fixed mock product JSON, `revalidate = false`.
- `/api/mock/navigation`: fixed mock navigation JSON, `revalidate = false`.
- `POST /api/revalidate?path=/`: calls `revalidatePath(path)` (defaults to `/`). It has no secret; the deployment URL is the only protection.

Local `next start` check, two rounds: after `POST /api/revalidate?path=/` the next HTML request is `MISS` (`revalidatePath` expires immediately), then `HIT`. HTML, RSC and API bytes and the HTML ETag were identical across both regenerations. Cached RSC and the API JSON are sent chunked without an ETag, as on the time-based baseline. Measure on Vercel as one confirmed `POST` → `MISS` → `HIT`, after warming.

### On-demand check

```sh
pnpm ondemand <base URL> [rounds=5] [interval seconds=60]
```

`tools/ondemand.ts` warms HTML, RSC and the mock product JSON, waits one interval, then per round samples all three, revalidates `/` and `/api/mock/product`, and samples twice more. Each line records a timestamp, `x-vercel-cache`/`x-nextjs-cache`, `Age`, ETag, Content-Length, body length and SHA-256, and whether the body and ETag match the warm reference. The timestamps align rounds with the Usage dashboard.

The page does not call either mock API. This is the control before connecting asynchronous data or other mocked application features.

### Vercel comparison: on-demand revalidation, unchanged output

Both branches use `revalidate = false`, default ETags and `pnpm ondemand https://next-isr-repro.vercel.app 5 60`: warm, 60-second cooldown, then five rounds one minute apart, each `POST /api/revalidate?path=/` and `?path=/api/mock/product` followed by HTML, RSC and API requests. Deployed to `next-isr-repro` production through the Vercel API. Write units are read per minute from the project's ISR Usage chart; values marked ≈ are read from bar heights, the others from the chart tooltip.

| Round | Output | 16.2.9 (`bugfix/repro-ondemand-app`, `dpl_8s77UmRKbSkqbyRgNaKf3oMY4dnJ`) | 16.5.0-canary.26 (`bugfix/repro-canary-ondemand-app`, `dpl_5Gvnd9ajTCgWZQWsUaCD5M8VWTw9`) |
| --- | --- | --- | --- |
| r1 | Changed: the first runtime render differs from the build prerender (+5 / +4 bytes) | ≈14 | 10 |
| r2 | Identical to r1 | ≈12 | **8** |
| r3 | Identical | ≈24 (page regenerated twice) | 8 |
| r4 | Identical | **12** | 8 |
| r5 | Identical | ≈24 (page regenerated twice) | **8** |
| Total | | 86 | 42 |

Rounds (UTC, 2026-10-26): 16.2.9 at 13:50:42, 13:51:46, 13:52:50, 13:53:54 and 13:54:58; canary at 14:37:16, 14:38:20, 14:39:24, 14:40:28 and 14:41:32. In rounds 2–5 the HTML and RSC SHA-256 and the HTML ETag were identical to round 1 every time.

On both versions, after every unchanged revalidation, the HTML response carried an ETag and kept its `Age` (about 63 seconds), while the RSC response had no ETag and its `Age` reset to 0. The mock API's `REVALIDATED` response had no ETag either; its `HIT` responses did. The ISR overview reported 0 time-based and 0 tag revalidations for these `revalidatePath` runs.

On-demand revalidation does not avoid the writes: unchanged output still costs about 12 write units per round on 16.2.9 and 8 on canary. This matches the ratio of the time-based App Router results (+6 and +4). The header pattern is consistent with the cached RSC being rewritten, but the Usage chart does not split write units by output, so it does not prove which outputs are charged.

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

### Established baseline behavior

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
