// experiments/dom-smoke.js - headless smoke test: runs app.js init + interactions
// against a minimal DOM shim. run: node experiments/dom-smoke.js
import * as C from '../core.js';

let failures = 0;
function ok(cond, msg) {
	if (cond) console.log('  ok - ' + msg);
	else { failures++; console.log('FAIL - ' + msg); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// the app runs on the real clock, so expectations are built from today, not
// hard-coded dates (this suite must survive midnight)
const realToday = C.localTodayMs();
const keyOfDay = ms => C.dateKeyOf(ms);
const todayKey = keyOfDay(realToday);
const shortLabel = ms => {
	const d = new Date(ms);
	const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
	const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
	return wd + ' ' + mo + ' ' + d.getDate();
};
const rangeEndFor = offset => keyOfDay(C.gridStartMs(realToday, offset) + 370 * C.DAY);

// ---- fake canvas 2d context (no-op, records nothing)
const ctx2d = new Proxy({}, {
	get(t, k) {
		if (k in t) return t[k];
		if (k === 'measureText') return () => ({ width: 100, actualBoundingBoxAscent: 40, actualBoundingBoxDescent: 10 });
		// alpha band in the vertical middle -> smooth text paints its center rows
		if (k === 'getImageData') return (x, y, w, h) => {
			const data = new Uint8ClampedArray(w * h * 4);
			for (let py = 0; py < h; py++) {
				if (py < h * 0.25 || py > h * 0.75) continue;
				for (let px = 0; px < w; px++) data[(py * w + px) * 4 + 3] = 255;
			}
			return { data };
		};
		return () => {};
	},
	set(t, k, v) { t[k] = v; return true; },
});

const LOGICAL_W = 30 + C.W * 19;
const LOGICAL_H = 18 + C.H * 19;
const TRACK_H = 40;

function makeEl(id) {
	const listeners = {};
	const el = {
		id,
		style: {},
		value: '',
		textContent: '',
		innerHTML: '',
		className: '',
		title: '',
		hidden: false,
		disabled: false,
		checked: false,
		files: [],
		width: 0,
		height: 0,
		parent: null,
		children: [],
		classList: { toggle() {}, add() {}, remove() {} },
		addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
		fire(type, ev) { (listeners[type] || []).forEach(fn => fn(ev || {})); },
		click() { this.fire('click', {}); },
		appendChild(child) { child.parent = this; this.children.push(child); return child; },
		remove() {
			const i = this.parent ? this.parent.children.indexOf(this) : -1;
			if (i >= 0) this.parent.children.splice(i, 1);
			this.parent = null;
		},
		setAttribute(k, v) { this[k] = v; },
		getBoundingClientRect() {
			if (id === 'plot') return { left: 0, top: 0, width: LOGICAL_W, height: LOGICAL_H };
			if (id === 'track') return { left: 0, top: LOGICAL_H + 4, width: LOGICAL_W, height: TRACK_H };
			if (id === 'trackWrap') return { left: 0, top: LOGICAL_H + 4, width: LOGICAL_W, height: TRACK_H };
			if (id === 'plotWrap') return { left: 0, top: 0, width: LOGICAL_W + 20, height: LOGICAL_H + TRACK_H + 20 };
			return { left: 0, top: 0, width: 100, height: 100 };
		},
	};
	if (id === 'created-canvas') el.getContext = () => ctx2d;
	return el;
}

const IDS = ['plot', 'plotWrap', 'tip', 'range', 'suggest', 'legend', 'status',
	'text', 'textFont', 'textReplace', 'offsetVal',
	'track', 'trackWrap', 'trackLabel', 'plan', 'planSummary', 'planDays', 'planCarry',
	'low', 'lowVal', 'high', 'highVal', 'display', 'ghUser', 'ghToken', 'btnFetch', 'btnDemo', 'fileImport',
	'btnExport', 'btnPng', 'btnImport', 'btnPaste', 'toolDraw', 'toolErase', 'toolRect',
	'btnFill', 'btnClear', 'btnUndo', 'btnRender'];
const els = {};
for (const id of IDS) els[id] = makeEl(id);
els.plot.getContext = () => ctx2d;
els.plot.setPointerCapture = () => {};
els.track.getContext = () => ctx2d;
els.track.setPointerCapture = () => {};
// markup defaults the app reads before any user interaction
els.planDays.value = '14';
els.planCarry.checked = true;
els.textFont.value = 'auto';
els.textReplace.checked = true;
els.low.value = '0';
els.high.value = '10';

const store = {};
globalThis.document = {
	getElementById: id => {
		if (!els[id]) throw new Error('missing element #' + id);
		return els[id];
	},
	createElement: tag => makeEl('created-' + tag),
};
globalThis.window = {
	devicePixelRatio: 1,
	requestAnimationFrame: fn => setTimeout(fn, 0),
	addEventListener: () => {},
};
globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
globalThis.localStorage = {
	getItem: k => (k in store ? store[k] : null),
	setItem: (k, v) => { store[k] = String(v); },
	removeItem: k => { delete store[k]; },
};
Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
globalThis.prompt = () => null;
globalThis.confirm = () => true;
// stubbed contributions provider (deno api shape): today 3 commits, yesterday 1,
// then 4 commits on each of the 88 days before -> over the 90 window days
// (today excluded): median 4, p90 4 -> recommended low 4, high max(8, 4 + 5) = 9
const stubDays = [{ date: todayKey, count: 3 }, { date: keyOfDay(realToday - C.DAY), count: 1 }];
const stubCursor = new Date(realToday - C.DAY);
for (let i = 0; i < 88; i++) {
	stubCursor.setDate(stubCursor.getDate() - 1);
	stubDays.push({ date: C.dateKeyOf(stubCursor.getTime()), count: 4 });
}
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => stubDays });

// ---- run the app
await import('../app.js');
await sleep(50); // let the rAF draw flush

const chip = i => els.plan.children[i];
const PITCH = 19;
function paintAt(col, row) {
	const ev = { clientX: 30 + col * PITCH + 8, clientY: 18 + row * PITCH + 8, pointerId: 1, preventDefault() {} };
	els.plot.fire('pointerdown', ev);
	els.plot.fire('pointerup', { pointerId: 1 });
}

ok(els.plot.width === LOGICAL_W, 'canvas backing width set (dpr=1)');
ok(els.track.width === LOGICAL_W, 'track canvas backing width set');
ok(els.track.height === TRACK_H, 'track canvas backing height set');
ok(els.status.textContent.includes('ready'), 'init status set');
ok(els.legend.innerHTML.includes('empty'), 'empty-grid legend hint');
ok(/^\d{4}-\d{2}-\d{2}  →  \d{4}-\d{2}-\d{2}$/.test(els.range.textContent), 'date range label: ' + els.range.textContent);
ok(els.offsetVal.textContent === '+26', 'fresh start centers today (offset +26): ' + els.offsetVal.textContent);
ok(els.lowVal.textContent === '0' && els.highVal.textContent === '10', 'mapping readouts at defaults: ' + els.lowVal.textContent + '/' + els.highVal.textContent);

// today at column 52 - 26 = 26, the center column of 53
ok(els.range.textContent.endsWith(rangeEndFor(26)), 'range ends half a year ahead: ' + els.range.textContent);

// commit plan: today sits mid-grid -> full default window (14 days)
ok(els.planSummary.textContent === '14 days · nothing planned', 'plan summary at init: ' + els.planSummary.textContent);
ok(els.plan.children.length === 14, 'plan renders the default 14-day window: ' + els.plan.children.length);
ok(chip(0)['data-key'] === todayKey, 'chip 0 keyed to today: ' + chip(0)['data-key']);
ok(chip(0).children[0].textContent === 'today · ' + shortLabel(realToday), 'chip 0 date line: ' + chip(0).children[0].textContent);
ok(chip(0).className.includes('today'), 'chip 0 marked today: ' + chip(0).className);
ok(chip(0).children[2].textContent === 'rest', 'empty day reads rest: ' + chip(0).children[2].textContent);

// tooltip on hover (col 20 row 3)
els.plot.fire('pointermove', { clientX: 30 + 20 * PITCH + 8, clientY: 18 + 3 * PITCH + 8 });
ok(!els.tip.hidden, 'tooltip visible on hover');
ok(els.tip.textContent.includes('level 0'), 'tooltip shows level 0: ' + els.tip.textContent);

// paint a 2-cell stroke: an empty grid draws level 1
els.plot.fire('pointerdown', { clientX: 30 + 20 * PITCH + 8, clientY: 18 + 3 * PITCH + 8, pointerId: 1, preventDefault() {} });
els.plot.fire('pointermove', { clientX: 30 + 21 * PITCH + 8, clientY: 18 + 3 * PITCH + 8, pointerId: 1, preventDefault() {} });
els.plot.fire('pointerup', { pointerId: 1 });
await sleep(400); // autosave debounce
ok(els.legend.innerHTML.includes('L1 ≈ 10 commits'), 'legend maps the drawn level to high: ' + els.legend.innerHTML.slice(0, 160));
ok(els.legend.innerHTML.includes('L0 background (none)'), 'legend: background (none) while low is 0');
ok(els.suggest.innerHTML.includes('Today'), 'suggestion box has Today row');
const saved = store['gtm-v1'];
ok(saved && saved.startsWith('GTM1|26|'), 'autosaved GTM1 string exists');
const parsed = C.parseGrid(saved);
ok(parsed.grid[20 * 7 + 3] === 1 && parsed.grid[21 * 7 + 3] === 1, 'stroke painted level 1 into saved grid');

// low / high sliders: readouts, cross-clamp, persistence
els.low.value = '12';
els.low.fire('input');
ok(els.lowVal.textContent === '12' && els.highVal.textContent === '12', 'low pushed above high drags high up: ' + els.lowVal.textContent + '/' + els.highVal.textContent);
els.high.value = '20';
els.high.fire('input');
ok(els.highVal.textContent === '20', 'high slider readout: ' + els.highVal.textContent);
els.high.value = '5';
els.high.fire('input');
ok(els.lowVal.textContent === '5' && els.highVal.textContent === '5', 'high pulled below low drags low down: ' + els.lowVal.textContent + '/' + els.highVal.textContent);
ok(els.legend.innerHTML.includes('L0 background ≈ 5 commits'), 'legend names the background number: ' + els.legend.innerHTML.slice(0, 160));
els.high.value = '10';
els.high.fire('input');
await sleep(400);
ok(store['gtm-map-v1'] === '5|10', 'mapping persisted: ' + store['gtm-map-v1']);
ok(els.suggest.innerHTML.includes('~5 commits</b> (background)'), 'today (empty cell) suggests the background number: ' + els.suggest.innerHTML.slice(0, 160));
els.low.value = '0';
els.low.fire('input');

// render pixel text "HI" (replaces grid)
els.text.value = 'HI';
els.textFont.value = '57';
els.textReplace.checked = true;
els.btnRender.click();
await sleep(400);
const saved2 = C.parseGrid(store['gtm-v1']);
let lit = 0, allLvl3 = true;
for (let i = 0; i < C.N; i++) {
	if (saved2.grid[i]) {
		lit++;
		if (saved2.grid[i] !== 1) allLvl3 = false;
	}
}
ok(lit === 28, 'rendered "HI" = 28 lit cells, got ' + lit);
ok(allLvl3, 'text painted at the draw level (current max)');

// track slider: mirrors the plot, not the timeline - the thumb at the left end
// pushes the grid into the future (+52), the right end is the past (-52), so
// the plot's dates follow the drag direction
const TRACK_INSET = 30;
const TRACK_USABLE = LOGICAL_W - TRACK_INSET;
function trackXForOffset(o) {
	return TRACK_INSET + (52 - o) / 104 * TRACK_USABLE;
}
function offsetForTrackX(x) {
	return Math.round(52 - (x - TRACK_INSET) / TRACK_USABLE * 104);
}
ok(trackXForOffset(5) < trackXForOffset(-5), 'future offsets sit left of past offsets');

const xPlus5 = trackXForOffset(5);
els.track.fire('pointerdown', { clientX: xPlus5, clientY: TRACK_H / 2, pointerId: 2, preventDefault() {} });
els.track.fire('pointerup', { pointerId: 2 });
await sleep(400);
ok(els.range.textContent.endsWith(rangeEndFor(5)), 'track click offset +5 ends ' + rangeEndFor(5) + ': ' + els.range.textContent);
ok(els.suggest.innerHTML.includes('Today'), 'offset +5: today still inside grid (earlier column)');
ok(els.offsetVal.textContent === '+5', 'offset readout shows +5');

// wheel scrub on the plot: positive deltaY -> offset decreases (move into the past)
els.plot.fire('wheel', { deltaY: 19, preventDefault() {}, cancelable: true });
ok(parseInt(els.offsetVal.textContent, 10) === 4, 'wheel +19 (1 week back) brought offset +5 to +4: ' + els.offsetVal.textContent);
els.plot.fire('wheel', { deltaY: 19 * 8, preventDefault() {}, cancelable: true });
await sleep(50);
ok(parseInt(els.offsetVal.textContent, 10) === -4, 'wheel +19*8 brought +4 to -4: ' + els.offsetVal.textContent);
els.plot.fire('wheel', { deltaY: -19, preventDefault() {}, cancelable: true }); // back 1 week into the future
await sleep(50);
ok(parseInt(els.offsetVal.textContent, 10) === -3, 'wheel -19 brought -4 to -3: ' + els.offsetVal.textContent);

// keyboard path on the track is spatial too: Home = left end = +52
els.track.focus = () => {};
els.track.fire('keydown', { key: 'Home', preventDefault() {} });
await sleep(50);
ok(els.offsetVal.textContent === '+52', 'track Home jumps to the future end: ' + els.offsetVal.textContent);
ok(els.suggest.innerHTML.includes('Today'), 'suggestion back to Today');
els.track.fire('keydown', { key: 'End', preventDefault() {} });
await sleep(50);
ok(els.offsetVal.textContent === '-52', 'track End jumps to the past end: ' + els.offsetVal.textContent);
els.track.fire('keydown', { key: 'ArrowLeft', preventDefault() {} });
await sleep(50);
ok(els.offsetVal.textContent === '-51', 'ArrowLeft moves the thumb left = future: ' + els.offsetVal.textContent);

// back to the centered default via a track click (today in the center column)
els.track.fire('pointerdown', { clientX: trackXForOffset(26), clientY: TRACK_H / 2, pointerId: 3, preventDefault() {} });
els.track.fire('pointerup', { pointerId: 3 });
await sleep(50);
ok(els.offsetVal.textContent === '+26', 'track click re-centers today: ' + els.offsetVal.textContent);

// plan follows painted cells: draw into today (center column 26, row 1) and yesterday (row 0)
els.btnClear.click(); // fresh grid: at this offset the past window crosses the HI pixels
const todayRow = new Date(realToday).getDay();
paintAt(26, todayRow);
paintAt(todayRow > 0 ? 26 : 25, todayRow > 0 ? todayRow - 1 : 6);
await sleep(400);
// yesterday is outside the plan window (rows start today), it only feeds the shortfall
ok(els.planSummary.textContent === '14 days · 10 commits on 1 day', 'plan summary after painting: ' + els.planSummary.textContent);
ok(chip(0).children[1].textContent === 'L1 · 10 commits', 'today chip level + commits: ' + chip(0).children[1].textContent);
ok(chip(0).children[2].textContent === 'planned', 'today chip without sync reads planned: ' + chip(0).children[2].textContent);
ok(chip(0).className.includes('due'), 'today chip marked due: ' + chip(0).className);
ok(chip(1).children[2].textContent === 'rest', 'empty future day reads rest: ' + chip(1).children[2].textContent);
ok(chip(0).title === 'plan 10 commits', 'chip title without sync: ' + chip(0).title);

// the plan window follows the selector (the grid has 188 days after today)
els.planDays.value = '30';
els.planDays.fire('change');
ok(els.plan.children.length === 30, '30-day window renders 30 chips: ' + els.plan.children.length);
els.planDays.value = '7';
els.planDays.fire('change');
ok(els.plan.children.length === 7, 'short window keeps 7 rows: ' + els.plan.children.length);

// sync (stubbed contributions api) -> recommended low / high from med / p90,
// actual counts, carry of the 7 day shortfall
els.ghUser.value = 'octocat';
els.btnFetch.click();
await sleep(100);
ok(els.status.textContent.includes('synced @octocat'), 'fetch status: ' + els.status.textContent);
ok(els.status.textContent.includes('med 4, p90 4 (90 d) → low 4, high 9'), 'fetch reports the recommendation: ' + els.status.textContent);
ok(els.lowVal.textContent === '4' && els.highVal.textContent === '9', 'sliders follow the recommendation: ' + els.lowVal.textContent + '/' + els.highVal.textContent);
ok(els.low.value === '4' && els.high.value === '9', 'slider inputs updated too');
ok(els.suggest.innerHTML.includes('actual 1'), 'suggestion shows yesterday actual');
// today: target 9 (drawn), 3 done, 6 left; last 7 days: yesterday drawn 9 - 1 = 8,
// the 6 background days before it 4 each and all met by the stub's 4 commits
ok(chip(0).children[2].textContent === '3 done · 14 left', 'today chip with sync + carry: ' + chip(0).children[2].textContent);
ok(chip(1).children[1].textContent === 'L0 · 4 commits', 'background day chip carries low: ' + chip(1).children[1].textContent);
ok(els.planSummary.textContent === '7 days · 33 commits on 7 days · behind 8 over the last 7 days', 'plan summary with low 4: ' + els.planSummary.textContent);
ok(chip(0).title === 'plan 9 commits + 8 carried from the last 7 days', 'chip title explains the carry: ' + chip(0).title);
els.planCarry.checked = false;
els.planCarry.fire('change');
ok(chip(0).children[2].textContent === '3 done · 6 left', 'carry off -> plain target left: ' + chip(0).children[2].textContent);
ok(!els.planSummary.textContent.includes('behind'), 'carry off -> no shortfall in summary');
els.planCarry.checked = true;
els.planCarry.fire('change');
// a 6 h cache hit reapplies the same recommendation
els.low.value = '0';
els.low.fire('input');
els.btnFetch.click();
await sleep(100);
ok(els.status.textContent.includes('cache (6h)') && els.lowVal.textContent === '4', 'cached fetch re-recommends: ' + els.status.textContent);

// paste import of a known payload
const g = new Uint8Array(C.N);
for (let i = 0; i < C.N; i++) g[i] = (i * 7) % 5;
globalThis.prompt = () => C.serializeGrid(-3, g);
els.btnPaste.click();
await sleep(400); // autosave debounce
const saved3 = C.parseGrid(store['gtm-v1']);
ok(saved3.off === -3, 'paste import offset -3');
ok(saved3.grid.every((v, i) => v === g[i]), 'paste import grid equal');
ok(els.offsetVal.textContent === '-3', 'offset readout synced after import');
ok(els.planSummary.textContent.includes('outside the grid'), 'off-grid plan shows the empty state: ' + els.planSummary.textContent);
ok(els.plan.children.length === 0, 'off-grid plan drops every chip: ' + els.plan.children.length);

// export downloads (a.click no-ops) and reports status
els.btnExport.click();
ok(els.status.textContent.includes('exported'), 'export status: ' + els.status.textContent);

// PNG export: data URL should be triggered; the shim's anchor.click is a no-op
// but the status line should mention the file name
// patch the created-canvas toDataURL for the test
const origCreate = globalThis.document.createElement;
globalThis.document.createElement = tag => {
	const el = origCreate(tag);
	if (tag === 'canvas') {
		el.getContext = () => ctx2d;
		el.toDataURL = () => 'data:image/png;base64,AAAA';
	}
	return el;
};
els.btnPng.click();
ok(els.status.textContent.includes('timeplot-'), 'PNG export status: ' + els.status.textContent);
globalThis.document.createElement = origCreate;

// clear -> confirm true -> grid zero
els.btnClear.click();
await sleep(400);
const saved4 = C.parseGrid(store['gtm-v1']);
ok(C.maxCell(saved4.grid) === 0, 'clear zeroes the grid');
ok(els.legend.innerHTML.includes('empty'), 'legend back to empty hint');

// undo restores previous grid
els.btnUndo.click();
await sleep(400);
const saved5 = C.parseGrid(store['gtm-v1']);
ok(saved5.grid.every((v, i) => v === g[i]) && saved5.off === -3, 'undo restores pre-clear grid + offset');

// auto font: 3x5 when 5x7 would overflow, 5x7 when it fits, no-op when neither fits
els.textFont.value = 'auto';
els.text.value = 'HELLO WORLD';
els.btnRender.click();
await sleep(400);
ok(els.status.textContent.includes('3x5 auto'), 'auto font picked 3x5: ' + els.status.textContent);
const savedAuto = C.parseGrid(store['gtm-v1']);
let autoLit = 0, topRowLit = 0;
for (let i = 0; i < C.N; i++) {
	if (!savedAuto.grid[i]) continue;
	autoLit++;
	if (i % 7 === 0) topRowLit++;
}
ok(autoLit > 0, 'auto font rendered cells: ' + autoLit);
ok(topRowLit === 0, '3x5 render keeps the top row empty');

els.text.value = 'ABCDEFGHIJKLMNOPQRST';
els.btnRender.click();
await sleep(400);
ok(els.status.textContent.includes('too wide'), 'too-wide text reports instead of clipping: ' + els.status.textContent);
const savedWide = C.parseGrid(store['gtm-v1']);
ok(savedWide.grid.every((v, i) => v === savedAuto.grid[i]), 'too-wide render leaves the grid untouched');

els.text.value = 'HI';
els.btnRender.click();
await sleep(400);
ok(els.status.textContent.includes('5x7 auto'), 'auto font picked 5x7 for short text: ' + els.status.textContent);

// demo button: simulated typical account + smooth HELLO WORLD, today centered
els.btnDemo.click();
await sleep(400);
ok(els.offsetVal.textContent === '+26', 'demo centers today: ' + els.offsetVal.textContent);
ok(els.lowVal.textContent === '5' && els.highVal.textContent === '10', 'demo sets the typical recommended mapping: ' + els.lowVal.textContent + '/' + els.highVal.textContent);
ok(els.text.value === 'hello world' && els.textFont.value === 'smooth', 'demo shows how it was made');
ok(els.status.textContent.includes('demo'), 'demo status: ' + els.status.textContent);
const savedDemo = C.parseGrid(store['gtm-v1']);
let noise = 0, core = 0;
for (let i = 0; i < C.N; i++) {
	if (savedDemo.grid[i] === 1 || savedDemo.grid[i] === 2) noise++;
	else if (savedDemo.grid[i] === 4) core++;
}
ok(noise > 20, 'demo background noise present: ' + noise + ' cells');
ok(core > 150, 'demo smooth text fills the center rows: ' + core + ' cells at the top level');
ok(els.legend.innerHTML.includes('L4'), 'legend covers the smooth top level');
els.btnUndo.click();
await sleep(400);
const savedUndo2 = C.parseGrid(store['gtm-v1']);
ok(savedUndo2.off === -3 && C.maxCell(savedUndo2.grid) > 0, 'undo restores the pre-demo grid + offset');

console.log(failures ? '\n' + failures + ' FAILURES' : '\nsmoke test passed');
process.exit(failures ? 1 : 0);
