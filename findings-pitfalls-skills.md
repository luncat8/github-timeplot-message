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
- A canvas used as a horizontal slider needs explicit `height` in CSS, not
  `height: auto` — otherwise the canvas shrinks proportionally with width
  and the slider thumb becomes impractically short on narrow viewports.
- `ctx.getImageData` context created with `{ willReadFrequently: true }`.
- Rebuild per-level color strings (a small array) only when max/display mode change;
  then the draw loop does zero string/alloc work.
- For PNG export of a 2D canvas with no external images, `canvas.toDataURL('image/png')`
  is safe — no tainting concerns. Use a fresh offscreen canvas with
  `setTransform(scale,0,0,scale,0,0)` and draw at logical coords.

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

## slider design (offset week picker)

- Make the slider a custom canvas (not `<input type="range">`) when the value
  is the primary navigation control and the visual width should match the plot.
  The DOM default is too small and its styling can't be made to align with a
  canvas-based grid.
- Single mutator function (`setOffset(v)`) that clamps, updates DOM readout,
  recomputes derived data, schedules renders, and triggers autosave. All UI
  entry points (drag, click, keyboard, wheel, import, undo) call this; nothing
  else mutates `offset`.
- Decouple the slider's `requestAnimationFrame` from the plot's — dragging
  the slider should only redraw the slider (cheap), but changing offset should
  redraw both.
- Wheel scrubbing: convert pixel delta to week count using `pitch` (cell pitch)
  as the step — `step = 19 px` matches `weeks = 1` intuitively. Accumulate
  sub-week fractional delta across events so trackpads don't feel sticky.
- Sign convention: `deltaY > 0` (scroll down) -> offset decreases (move into
  the past). Matches GitHub's own contribution graph time direction and the
  expected "scroll down = older" convention.

## commit plan / carry

- A plan window that starts at today must not try to also cover the past: rows are
  "today + n". Yesterday still matters, but only as an input (the shortfall), never
  as a row — otherwise the totals mix what is done with what is planned.
- "Day missing from the actual-commits map" is ambiguous: absent can mean 0 commits
  or "not fetched". It is safe to read it as 0 only because every provider covers the
  whole grid range; with the events fallback (recent months only) the carry is an
  over-estimate, which is why the UI labels that provider "approx".
- Carry only today: adding the shortfall to future days would quietly inflate the
  plan. Keep `left = target - actual` for every other day.
- Rebuilding the plan as chips: create the DOM nodes once per row-count change
  (`ensurePlanChips(n)`) and afterwards only write `textContent` / `className`. The
  panel follows every painted cell, so `innerHTML = ''` per stroke is wasteful.
  Chips keyed by date also let the date line be skipped when only the level changed.
- Status text must distinguish three states, not two: no data (`planned`), known and
  met (`done ✓`), known and short (`N left`). Collapsing "no data" into "0 commits
  done" makes an unsynced app look like it is permanently behind.

## auto font fit

- Deciding which bitmap font fits is pure width table lookup
  (`textWidth57 <= 53 ? '57' : textWidth35 <= 53 ? '35' : null`). Do not measure by
  rendering: the advance is fixed (5+1 / 3+1) minus the trailing gap.
- When nothing fits, report the needed column count and leave the grid untouched —
  silently clipping a 20-char string looks like a rendering bug.

## PNG export

- The drawing routine must take a `ctx` parameter (not be hard-coded to the
  on-screen `ctx`). One helper, two callers: live render + PNG.
- A 2x scale gives crisp output on retina displays without ballooning file size.
- `toDataURL` works without taint since we don't load external images.
- Don't put transient UI state (rect drag preview, hover highlights) into the
  PNG — those don't represent the saved plan.
