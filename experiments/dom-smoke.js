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

function makeEl(id) {
	const listeners = {};
	return {
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
			return id === 'plot'
				? { left: 0, top: 0, width: LOGICAL_W, height: LOGICAL_H }
				: { left: 0, top: 0, width: 100, height: 100 };
		},
	};
}

const IDS = ['plot', 'plotWrap', 'tip', 'range', 'suggest', 'legend', 'status',
	'text', 'textFont', 'textReplace', 'amount', 'amountVal', 'offset', 'offsetVal',
	'low', 'high', 'display', 'ghUser', 'ghToken', 'btnFetch', 'fileImport',
	'btnExport', 'btnImport', 'btnPaste', 'toolDraw', 'toolErase', 'toolRect',
	'btnFill', 'btnClear', 'btnUndo', 'btnRender'];
const els = {};
for (const id of IDS) els[id] = makeEl(id);
els.plot.getContext = () => ctx2d;
els.plot.setPointerCapture = () => {};

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
ok(els.status.textContent.includes('ready'), 'init status set');
ok(els.legend.innerHTML.includes('empty'), 'empty-grid legend hint');
ok(/^\d{4}-\d{2}-\d{2}  →  \d{4}-\d{2}-\d{2}$/.test(els.range.textContent), 'date range label: ' + els.range.textContent);

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

// offset slider into future: +5 w -> range ends 2026-10-31; today still inside grid
els.offset.value = '5';
els.offset.fire('input');
ok(els.range.textContent.endsWith('2026-10-31'), 'offset +5 ends 2026-10-31: ' + els.range.textContent);
ok(els.suggest.innerHTML.includes('Today'), 'offset +5: today still inside grid (earlier column)');

// offset into the past: -1 w -> grid ends before today -> "outside" message
els.offset.value = '-1';
els.offset.fire('input');
ok(els.suggest.innerHTML.includes('outside'), 'offset -1: suggestion notes today outside grid');

// back to 0
els.offset.value = '0';
els.offset.fire('input');
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
ok(els.offset.value === '-3', 'offset slider synced after import');

// export downloads (a.click no-ops) and reports status
els.btnExport.click();
ok(els.status.textContent.includes('exported'), 'export status: ' + els.status.textContent);

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
