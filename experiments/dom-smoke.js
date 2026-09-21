// experiments/dom-smoke.js - headless smoke test: runs app.js init + interactions
// against a minimal DOM shim. run: node experiments/dom-smoke.js
import * as C from '../core.js';

let failures = 0;
function ok(cond, msg) {
	if (cond) console.log('  ok - ' + msg);
	else { failures++; console.log('FAIL - ' + msg); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- fake canvas 2d context (no-op, records nothing)
const ctx2d = new Proxy({}, {
	get(t, k) {
		if (k in t) return t[k];
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
	'text', 'textFont', 'textReplace', 'amount', 'amountVal', 'offsetVal',
	'track', 'trackWrap', 'trackLabel', 'plan', 'planSummary', 'planDays', 'planCarry',
	'low', 'high', 'display', 'ghUser', 'ghToken', 'btnFetch', 'fileImport',
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
// stubbed contributions provider (deno api shape): today 3 commits, yesterday 1
globalThis.fetch = async () => ({
	ok: true,
	status: 200,
	json: async () => [{ date: '2026-09-21', count: 3 }, { date: '2026-09-20', count: 1 }],
});

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
ok(els.offsetVal.textContent === '0', 'offset readout shows 0 at start');

// today (2026-09-21 Monday) must be highlighted window: offset 0 ends Sat 2026-09-26
ok(els.range.textContent.endsWith('2026-09-26'), 'range ends this Saturday: ' + els.range.textContent);

// commit plan: today sits in the last column at offset 0 -> 6 rows (Mon..Sat)
ok(els.planSummary.textContent === '6 days · nothing planned', 'plan summary at init: ' + els.planSummary.textContent);
ok(els.plan.children.length === 6, 'plan renders one chip per remaining day: ' + els.plan.children.length);
ok(chip(0)['data-key'] === '2026-09-21', 'chip 0 keyed to today: ' + chip(0)['data-key']);
ok(chip(0).children[0].textContent === 'today · Mon Sep 21', 'chip 0 date line: ' + chip(0).children[0].textContent);
ok(chip(0).className.includes('today'), 'chip 0 marked today: ' + chip(0).className);
ok(chip(0).children[2].textContent === 'rest', 'empty day reads rest: ' + chip(0).children[2].textContent);

// tooltip on hover (col 20 row 3)
els.plot.fire('pointermove', { clientX: 30 + 20 * PITCH + 8, clientY: 18 + 3 * PITCH + 8 });
ok(!els.tip.hidden, 'tooltip visible on hover');
ok(els.tip.textContent.includes('level 0'), 'tooltip shows level 0: ' + els.tip.textContent);

// paint a 2-cell stroke with default amount 3
els.plot.fire('pointerdown', { clientX: 30 + 20 * PITCH + 8, clientY: 18 + 3 * PITCH + 8, pointerId: 1, preventDefault() {} });
els.plot.fire('pointermove', { clientX: 30 + 21 * PITCH + 8, clientY: 18 + 3 * PITCH + 8, pointerId: 1, preventDefault() {} });
els.plot.fire('pointerup', { pointerId: 1 });
await sleep(400); // autosave debounce
ok(els.legend.innerHTML.includes('L3'), 'legend shows L3 after paint: ' + els.legend.innerHTML.slice(0, 120));
ok(els.suggest.innerHTML.includes('Today'), 'suggestion box has Today row');
const saved = store['gtm-v1'];
ok(saved && saved.startsWith('GTM1|0|'), 'autosaved GTM1 string exists');
const parsed = C.parseGrid(saved);
ok(parsed.grid[20 * 7 + 3] === 3 && parsed.grid[21 * 7 + 3] === 3, 'stroke painted level 3 into saved grid');

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
		if (saved2.grid[i] !== 3) allLvl3 = false;
	}
}
ok(lit === 28, 'rendered "HI" = 28 lit cells, got ' + lit);
ok(allLvl3, 'text painted at level 3 (current max)');

// track slider drag into future: x = midpoint (offset 0) + half usable -> offset ~ +26
const TRACK_INSET = 30;
const TRACK_USABLE = LOGICAL_W - TRACK_INSET;
function trackXForOffset(o) {
	return TRACK_INSET + (o + 52) / 104 * TRACK_USABLE;
}
function offsetForTrackX(x) {
	return Math.round(-52 + (x - TRACK_INSET) / TRACK_USABLE * 104);
}

const xPlus5 = trackXForOffset(5);
els.track.fire('pointerdown', { clientX: xPlus5, clientY: TRACK_H / 2, pointerId: 2, preventDefault() {} });
els.track.fire('pointerup', { pointerId: 2 });
await sleep(400);
ok(els.range.textContent.endsWith('2026-10-31'), 'track click offset +5 ends 2026-10-31: ' + els.range.textContent);
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

// back to 0 via direct API (no slider anymore)
import('../app.js').catch(() => {}); // no-op: ensure module stays loaded
// use the keyboard shortcut path on the track
els.track.focus = () => {};
els.track.fire('keydown', { key: 'Home', preventDefault() {} });
await sleep(50);
ok(parseInt(els.offsetVal.textContent, 10) === 0, 'track Home resets offset to 0: ' + els.offsetVal.textContent);
ok(els.suggest.innerHTML.includes('Today'), 'suggestion back to Today');

// plan follows painted levels: amount 2 into today (Mon of last column) and yesterday (Sun)
els.amount.value = '2';
els.amount.fire('input');
paintAt(52, 1);
paintAt(52, 0);
await sleep(400);
// yesterday is outside the plan window (rows start today), it only feeds the shortfall
ok(els.planSummary.textContent === '6 days · 8 commits on 1 day', 'plan summary after painting: ' + els.planSummary.textContent);
ok(chip(0).children[1].textContent === 'L2 · 8 commits', 'today chip level + commits: ' + chip(0).children[1].textContent);
ok(chip(0).children[2].textContent === 'planned', 'today chip without sync reads planned: ' + chip(0).children[2].textContent);
ok(chip(0).className.includes('due'), 'today chip marked due: ' + chip(0).className);
ok(chip(1).children[2].textContent === 'rest', 'empty future day reads rest: ' + chip(1).children[2].textContent);
ok(chip(0).title === 'plan 8 commits', 'chip title without sync: ' + chip(0).title);

// the plan never runs past the end of the grid, whatever the window says
els.planDays.value = '30';
els.planDays.fire('change');
ok(els.plan.children.length === 6, '30 requested days still clip at the grid end: ' + els.plan.children.length);
els.planDays.value = '7';
els.planDays.fire('change');
ok(els.plan.children.length === 6, 'short window keeps the same rows: ' + els.plan.children.length);

// sync (stubbed contributions api) -> actual counts, carry of the 7 day shortfall
els.ghUser.value = 'octocat';
els.btnFetch.click();
await sleep(100);
ok(els.status.textContent.includes('synced @octocat'), 'fetch status: ' + els.status.textContent);
ok(els.suggest.innerHTML.includes('actual 1'), 'suggestion shows yesterday actual');
ok(chip(0).children[2].textContent === '3 done · 12 left', 'today chip with sync + carry: ' + chip(0).children[2].textContent);
ok(els.planSummary.textContent.includes('behind 7 over the last 7 days'), 'plan summary shortfall: ' + els.planSummary.textContent);
ok(chip(0).title.includes('+ 7 carried'), 'chip title explains the carry: ' + chip(0).title);
els.planCarry.checked = false;
els.planCarry.fire('change');
ok(chip(0).children[2].textContent === '3 done · 5 left', 'carry off -> plain target left: ' + chip(0).children[2].textContent);
ok(!els.planSummary.textContent.includes('behind'), 'carry off -> no shortfall in summary');
els.planCarry.checked = true;
els.planCarry.fire('change');

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

console.log(failures ? '\n' + failures + ' FAILURES' : '\nsmoke test passed');
process.exit(failures ? 1 : 0);
