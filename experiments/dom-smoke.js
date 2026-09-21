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
		hidden: false,
		disabled: false,
		files: [],
		width: 0,
		height: 0,
		classList: { toggle() {}, add() {}, remove() {} },
		addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
		fire(type, ev) { (listeners[type] || []).forEach(fn => fn(ev || {})); },
		click() { this.fire('click', {}); },
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
	'track', 'trackWrap', 'trackLabel',
	'low', 'high', 'display', 'ghUser', 'ghToken', 'btnFetch', 'fileImport',
	'btnExport', 'btnPng', 'btnImport', 'btnPaste', 'toolDraw', 'toolErase', 'toolRect',
	'btnFill', 'btnClear', 'btnUndo', 'btnRender'];
const els = {};
for (const id of IDS) els[id] = makeEl(id);
els.plot.getContext = () => ctx2d;
els.plot.setPointerCapture = () => {};
els.track.getContext = () => ctx2d;
els.track.setPointerCapture = () => {};

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

// ---- run the app
await import('../app.js');
await sleep(50); // let the rAF draw flush

ok(els.plot.width === LOGICAL_W, 'canvas backing width set (dpr=1)');
ok(els.track.width === LOGICAL_W, 'track canvas backing width set');
ok(els.track.height === TRACK_H, 'track canvas backing height set');
ok(els.status.textContent.includes('ready'), 'init status set');
ok(els.legend.innerHTML.includes('empty'), 'empty-grid legend hint');
ok(/^\d{4}-\d{2}-\d{2}  →  \d{4}-\d{2}-\d{2}$/.test(els.range.textContent), 'date range label: ' + els.range.textContent);
ok(els.offsetVal.textContent === '0', 'offset readout shows 0 at start');

// today (2026-09-21 Monday) must be highlighted window: offset 0 ends Sat 2026-09-26
ok(els.range.textContent.endsWith('2026-09-26'), 'range ends this Saturday: ' + els.range.textContent);

// tooltip on hover (col 20 row 3)
const PITCH = 19;
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

console.log(failures ? '\n' + failures + ' FAILURES' : '\nsmoke test passed');
process.exit(failures ? 1 : 0);
