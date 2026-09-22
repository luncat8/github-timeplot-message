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

## low / high mapping

- Level 0 is not "no commits", it is `low`. Real accounts commit on background days
  too, so the drawn shape only shows if the background rate is the *usual* rate and
  drawn days sit above it. `low = 0` keeps the old meaning. Every consumer (legend,
  tooltip, suggestion, plan, shortfall) goes through `commitsForLevel`, so one
  change there moved the whole app.
- Two range inputs that share a constraint (`high >= low`) need a single setter
  with a `from` argument: the slider the user is dragging wins, the other one is
  dragged along. Clamping the moved slider instead feels broken ("it won't go
  further") and leaves the readout lying.
- A "draw amount" slider next to low/high was the same knob twice: amount picked a
  level, low/high mapped levels to commits. Dropping amount (draw = top level,
  erase = 0) made hand-drawn pictures two-tone, which is what they were anyway;
  shades only ever came from smooth text.
- Recommendation from the daily counts of the last 90 days (today excluded, absent
  = 0): `low = median day`, `high = max(p90 busy day, 2 * low, low + 5)`. The mean
  version (`low = round(mean)`) let one 50-commit spike or a dead month drag the
  numbers; median / p90 are exactly "typical day" and "busy day". Nearest-rank
  quantiles (`sorted[ceil(q * n) - 1]`) on a small in-place-sorted scratch array
  need no allocation. Keep the `2 * low` / `+5` floors: quiet accounts (median 0)
  still need a visible picture.
- The sliders' `input` event (not `change`) keeps the legend / plan live while
  dragging; `refreshColors` is cheap enough.

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

## week offset track direction

- Users read the track as a viewport scrollbar for the plot, not as a time axis:
  dragging right should shift the plot's dates right (content follows the hand),
  which means offset increases rightward and the END LABELS are mirrored
  (`+52w` left, `-52w` right). Mapping the thumb to the calendar instead feels
  reversed the moment you also scroll the plot with the wheel.
- Once the axis is spatial, the keys follow the thumb, not the calendar:
  Home = left end = +52 (future), End = right end = -52 (past), ArrowRight = thumb
  right = older. Wheel keeps its "scroll down = older" convention on both plot
  and track.
- With today always at column `26 - offset` (offset 0 = center column 26 of
  53), the slider center / today marker / thumb at rest all sit where today is
  centered — half a year of history left, half a year of plan right. Positive
  offset slides the grid forward (today walks left, into the future), negative
  back toward the past. Default `offset = 0`; saved sessions keep their stored
  offset, so a legacy saved `+26` now opens with today on the left edge (re-center
  with a click on the track middle).

## smooth text (small-bitmap antialiasing)

- `getImageData` byte index is `((y * width) + x) * 4 + component`. Forgetting the
  `* 4` on the y term (writing `(y0 + py) * gw + x0 * 4`) reads a vertically
  squashed strip of the bitmap - the sampler then sees one glyph quarter stretched
  over all rows. Symptom: antialiased text rows all similar, levels wrong.
- Fit and center on the ink box, not the em box: measure
  `actualBoundingBoxAscent/Descent` at a reference size, scale
  `fs = target / (asc + desc) * refSize`, draw with `textBaseline = 'alphabetic'`
  at `y = center + (asc - desc) / 2`. A hard-coded cap-height ratio (0.72) is
  font-dependent and mis-centers lowercase and descenders.
- Per-cell coverage mapped linearly to the level turns to mush at 7 rows (glyphs
  3-4 cells tall, strokes 1 cell wide land on mid levels with wide halos).
  Contrast-stretch instead: below ~0.16 coverage -> background, above ~0.62 ->
  solid top level, linear in between. Strokes get a crisp dark core, edges stay
  antialiased, and the `max(1, ..)` floor keeps edge cells from vanishing.
- Merging smooth text over painted noise (`replace = false` -> `lvl > grid[i]`)
  lets a demo keep its background: the caller decides, not the checkbox.

## headless screenshots (playwright in a CDN-blocked sandbox)

- `@sparticuz/chromium` (npm) bundles a chromium binary as brotli - no browser
  download needed: `chromium.launch({ executablePath: await chromium.executablePath(),
  args: chromium.args })` with `playwright-core`.
- It only extracts its bundled shared libs (libnspr4 etc.) when it believes it is
  on an AWS Lambda node runtime: set `AWS_EXECUTION_ENV=AWS_Lambda_nodejs22.x`
  (or CODEBUILD_BUILD_IMAGE=nodejs22...) outside Lambda, or the binary dies with
  `libnspr4.so: cannot open shared object file`.
- Its default args include `--single-process`; opening a second page with a
  different `deviceScaleFactor` can take the whole browser down. One DPR per
  browser instance.
- ES modules do not load from `file://` - serve the folder over localhost
  (a 20-line node:http server) and remember the `/` -> `index.html` fallback;
  a static server without it 404s the root and the page stays blank.
- Verify screenshots by decoding pixels, not by eyeballing a preview:
  nearest-anchor classification of cell-center samples catches "the click never
  fired" / "empty grid" immediately.
