# findings / pitfalls / skills

## github api (CORS, shapes)

- `api.github.com` REST sends `Access-Control-Allow-Origin: *` -> safe to call
  unauthenticated from the browser (60 req/h per IP).
- `api.github.com/graphql` requires auth even for public data -> optional PAT field.
- `events/public` PushEvent carries `payload.size` = commits in that push; only the
  newest ~300 events are reachable -> use as *approximate* no-auth fallback only.
- Third-party `github-contributions-api.deno.dev/{user}.json` returned
  SSL_ERROR_SYSCALL from the sandbox; may or may not work in user browsers. That is
  why the fetcher is a chain (graphql -> deno -> events), not a single provider.

## date math

- 53-week grid ending on a Saturday: `start = end - 370 days` (NOT 364). 370 % 7 == 6
  so a Saturday minus 370 lands on a Sunday. Off-by-one here shows up as "grid start
  is a Saturday" and broken week alignment.
- Walk days with `Date.setDate(d.getDate() + 1)` instead of `+86400000` to stay
  correct across DST; ms math is fine for whole-week offsets.

## normalization

- The draft example `0,2,3 -> 0, 255/4*3, 255` decodes to `t(L) = (L+1)/(max+1)`,
  not `L/max`. One formula drives both color and commit-count mapping, so the legend
  and the suggestion always agree.

## canvas

- DPR: backing store = logical size * dpr, `ctx.setTransform(dpr,0,0,dpr,0,0)`,
  CSS `width:100%; height:auto`. Pointer -> cell needs `clientX * LOGICAL_W /
  rect.width` (CSS scaling), not raw clientX.
- `ctx.getImageData` context created with `{ willReadFrequently: true }`.
- Rebuild per-level color strings (a small array) only when max/display mode change;
  then the draw loop does zero string/alloc work.

## headless testing of a no-build page

- `experiments/dom-smoke.js` runs the real `app.js` under a ~40-line DOM shim
  (Proxy-based 2d context, per-id element registry, in-memory localStorage).
  Catches init-order bugs, bad element ids, handler wiring — without a browser.
- Node 22: `globalThis.navigator` is a read-only getter -> use
  `Object.defineProperty(globalThis, 'navigator', {value:{}, configurable:true})`.
- Node >= 22 runs `.js` ESM files without package.json (syntax detection).

## process

- Keep `core.js` DOM-free so node tests import it directly; `app.js` may not parse
  in node, the smoke shim is the substitute.
