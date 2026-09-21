// app.js - DOM, canvas and events for github-timeplot-message. Pure logic lives in core.js.
import * as C from './core.js';

// ---- dom refs
const $ = id => document.getElementById(id);
const canvas = $('plot');
const ctx = canvas.getContext('2d');
const plotWrap = $('plotWrap');
const tip = $('tip');
const rangeEl = $('range');
const suggestEl = $('suggest');
const legendEl = $('legend');
const statusEl = $('status');
const textEl = $('text');
const textFontEl = $('textFont');
const textReplaceEl = $('textReplace');
const amountEl = $('amount');
const amountValEl = $('amountVal');
const offsetEl = $('offset');
const offsetValEl = $('offsetVal');
const lowEl = $('low');
const highEl = $('high');
const displayEl = $('display');
const ghUserEl = $('ghUser');
const ghTokenEl = $('ghToken');
const btnFetch = $('btnFetch');
const fileImport = $('fileImport');

// ---- canvas geometry (logical px; backing store scaled by DPR)
const LABEL_W = 30;
const LABEL_H = 18;
const CELL = 16;
const GAP = 3;
const PITCH = CELL + GAP;
const LOGICAL_W = LABEL_W + C.W * PITCH;
const LOGICAL_H = LABEL_H + C.H * PITCH;
const INSET = GAP / 2;

const EMPTY_COLOR = 'rgb(235,237,240)';
const FUTURE_COLOR = 'rgba(209,213,219,0.4)';
const DOT_COLOR = 'rgb(212,167,44)';
const LABEL_COLOR = '#57606a';

// ---- state
const grid = new Uint8Array(C.N);
let offset = 0;
let tool = 'draw';
let amount = 3;
let displayMode = 'grad';
let low = 1;
let high = 10;
let maxLvl = 0;
let colorCache = C.buildColorCache(0, displayMode);
let actual = null;          // Map<dateKey, count> | null
let drawing = false;
let dragA = -1;
let dragB = -1;
let lastPaint = -1;
let saveTimer = 0;
let renderQueued = false;
const undoStack = [];
const todayMs = C.localTodayMs();

// per-offset precomputed buffers (rebuilt on offset change only)
const cellKey = new Array(C.N);
const cellLabel = new Array(C.N);
const colMonth = new Array(C.W);
const monthText = new Array(C.W);
const isFuture = new Uint8Array(C.N);
let todayIdx = -1;

// ---- small ui helpers
function status(msg) {
	statusEl.textContent = msg;
}

function scheduleRender() {
	if (renderQueued) return;
	renderQueued = true;
	requestAnimationFrame(() => {
		renderQueued = false;
		draw();
	});
}

// ---- per-offset precompute (user action, not hot path)
function recomputeDates() {
	C.buildGridDates(todayMs, offset, cellKey, cellLabel, colMonth);
	todayIdx = C.todayIndex(cellKey, todayMs);
	const tk = C.dateKeyOf(todayMs);
	for (let i = 0; i < C.N; i++) isFuture[i] = cellKey[i] > tk ? 1 : 0;
	for (let c = 0; c < C.W; c++) {
		monthText[c] = (c === 0 || colMonth[c] !== colMonth[c - 1]) ? C.MONTHS_SHORT[colMonth[c]] : '';
	}
	rangeEl.textContent = cellKey[0] + '  →  ' + cellKey[C.N - 1];
}

function refreshColors() {
	maxLvl = C.maxCell(grid);
	colorCache = C.buildColorCache(maxLvl, displayMode);
	refreshLegend();
	refreshSuggestion();
}

// grid (or offset via caller) changed
function markDirty() {
	refreshColors();
	scheduleRender();
	saveSoon();
}

// ---- undo
function pushUndo() {
	undoStack.push({ grid: grid.slice(), off: offset });
	if (undoStack.length > 20) undoStack.shift();
}

function doUndo() {
	const s = undoStack.pop();
	if (!s) {
		status('nothing to undo');
		return;
	}
	grid.set(s.grid);
	if (s.off !== offset) {
		offset = s.off;
		offsetEl.value = String(offset);
		offsetValEl.textContent = String(offset);
		recomputeDates();
	}
	refreshColors();
	scheduleRender();
	saveSoon();
}

// ---- draw (on demand, batched; no allocations inside)
function draw() {
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

	ctx.fillStyle = LABEL_COLOR;
	ctx.font = '11px system-ui, sans-serif';
	ctx.textBaseline = 'middle';
	for (let c = 0; c < C.W; c++) {
		const t = monthText[c];
		if (t) ctx.fillText(t, LABEL_W + c * PITCH, LABEL_H / 2);
	}
	ctx.fillText('Mon', 4, LABEL_H + 1 * PITCH + CELL / 2);
	ctx.fillText('Wed', 4, LABEL_H + 3 * PITCH + CELL / 2);
	ctx.fillText('Fri', 4, LABEL_H + 5 * PITCH + CELL / 2);

	for (let c = 0; c < C.W; c++) {
		const x = LABEL_W + c * PITCH + INSET;
		for (let r = 0; r < C.H; r++) {
			const i = c * C.H + r;
			const lvl = grid[i];
			if (lvl) ctx.fillStyle = colorCache[lvl];
			else if (isFuture[i]) ctx.fillStyle = FUTURE_COLOR;
			else ctx.fillStyle = EMPTY_COLOR;
			ctx.fillRect(x, LABEL_H + r * PITCH + INSET, CELL, CELL);
		}
	}

	if (actual) {
		ctx.fillStyle = DOT_COLOR;
		for (let i = 0; i < C.N; i++) {
			const n = actual.get(cellKey[i]);
			if (n) {
				const c = (i / C.H) | 0;
				const r = i % C.H;
				ctx.fillRect(LABEL_W + c * PITCH + CELL - 4, LABEL_H + r * PITCH + CELL - 4, 3, 3);
			}
		}
	}

	if (todayIdx >= 0) {
		const c = (todayIdx / C.H) | 0;
		const r = todayIdx % C.H;
		ctx.strokeStyle = 'rgb(31,35,40)';
		ctx.lineWidth = 2;
		ctx.strokeRect(LABEL_W + c * PITCH, LABEL_H + r * PITCH, CELL + GAP, CELL + GAP);
	}

	if (tool === 'rect' && drawing && dragA >= 0) {
		let c1 = (dragA / C.H) | 0, r1 = dragA % C.H;
		let c2 = dragB >= 0 ? (dragB / C.H) | 0 : c1, r2 = dragB >= 0 ? dragB % C.H : r1;
		if (c1 > c2) { const t = c1; c1 = c2; c2 = t; }
		if (r1 > r2) { const t = r1; r1 = r2; r2 = t; }
		const x = LABEL_W + c1 * PITCH;
		const y = LABEL_H + r1 * PITCH;
		const w = (c2 - c1 + 1) * PITCH;
		const h = (r2 - r1 + 1) * PITCH;
		ctx.fillStyle = 'rgba(33,110,57,0.15)';
		ctx.fillRect(x, y, w, h);
		ctx.strokeStyle = 'rgb(33,110,57)';
		ctx.lineWidth = 1;
		ctx.setLineDash([4, 3]);
		ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
		ctx.setLineDash([]);
	}
}

// ---- pointer
function pickCell(e) {
	const rect = canvas.getBoundingClientRect();
	const x = (e.clientX - rect.left) * LOGICAL_W / rect.width;
	const y = (e.clientY - rect.top) * LOGICAL_H / rect.height;
	const c = Math.floor((x - LABEL_W) / PITCH);
	const r = Math.floor((y - LABEL_H) / PITCH);
	if (c < 0 || c >= C.W || r < 0 || r >= C.H) return -1;
	return c * C.H + r;
}

function paintCell(i) {
	const v = tool === 'erase' ? 0 : amount;
	if (grid[i] === v) return;
	grid[i] = v;
	markDirty();
}

canvas.addEventListener('pointerdown', e => {
	e.preventDefault();
	const i = pickCell(e);
	if (i < 0) return;
	canvas.setPointerCapture(e.pointerId);
	drawing = true;
	lastPaint = i;
	if (tool === 'rect') {
		dragA = i;
		dragB = -1;
		scheduleRender();
	} else {
		pushUndo();
		paintCell(i);
	}
});

canvas.addEventListener('pointermove', e => {
	const i = pickCell(e);
	setHover(i);
	if (!drawing) return;
	if (i < 0 || i === lastPaint) return;
	lastPaint = i;
	if (tool === 'rect') {
		dragB = i;
		scheduleRender();
	} else {
		paintCell(i);
	}
});

function endStroke() {
	if (!drawing) return;
	drawing = false;
	if (tool === 'rect' && dragA >= 0) {
		pushUndo();
		fillRectCells(dragA, dragB >= 0 ? dragB : dragA, amount);
	}
	dragA = -1;
	dragB = -1;
	scheduleRender();
}

canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);
canvas.addEventListener('pointerleave', () => setHover(-1));

function fillRectCells(a, b, lvl) {
	let c1 = (a / C.H) | 0, r1 = a % C.H;
	let c2 = (b / C.H) | 0, r2 = b % C.H;
	if (c1 > c2) { const t = c1; c1 = c2; c2 = t; }
	if (r1 > r2) { const t = r1; r1 = r2; r2 = t; }
	for (let c = c1; c <= c2; c++)
		for (let r = r1; r <= r2; r++)
			grid[c * C.H + r] = lvl;
	markDirty();
}

// ---- tooltip
function setHover(i) {
	if (i < 0) {
		tip.hidden = true;
		return;
	}
	const lvl = grid[i];
	let s = cellLabel[i] + ' · level ' + lvl + (maxLvl ? '/' + maxLvl : '');
	s += ' · ~' + C.commitsForLevel(lvl, maxLvl, low, high) + ' commits';
	if (actual) {
		const a = actual.get(cellKey[i]);
		s += ' · actual ' + (a || 0);
	}
	if (isFuture[i]) s += ' · future';
	tip.textContent = s;
	tip.hidden = false;
	const wrap = plotWrap.getBoundingClientRect();
	const rect = canvas.getBoundingClientRect();
	const scale = rect.width / LOGICAL_W;
	const c = (i / C.H) | 0;
	const r = i % C.H;
	tip.style.left = (rect.left - wrap.left + (LABEL_W + (c + 0.5) * PITCH) * scale) + 'px';
	tip.style.top = (rect.top - wrap.top + (LABEL_H + r * PITCH) * scale - 6) + 'px';
}

// ---- text rendering
function renderText() {
	const text = textEl.value;
	if (!text.trim()) {
		status('type some text first');
		return;
	}
	pushUndo();
	if (textFontEl.value === 'smooth') {
		smoothText(text);
	} else {
		const lvl = Math.max(maxLvl, 1);
		if (textReplaceEl.checked) grid.fill(0);
		C.renderTextPixel(grid, text, textFontEl.value, lvl);
	}
	markDirty();
	status('rendered text');
}

// antialiased: 4x offscreen bold text, per-cell average alpha -> level
function smoothText(text) {
	const S = 4;
	const gw = C.W * PITCH * S;
	const gh = C.H * PITCH * S;
	const off = document.createElement('canvas');
	off.width = gw;
	off.height = gh;
	const octx = off.getContext('2d', { willReadFrequently: true });
	const maxEff = Math.max(maxLvl, 4);
	const font = '900 100px system-ui, -apple-system, "Segoe UI", Arial, sans-serif';
	octx.font = font;
	const w100 = octx.measureText(text.toUpperCase()).width || 1;
	const fs = Math.min(gw * 0.92 / w100 * 100, gh * 0.9 / 0.72);
	octx.font = '900 ' + fs + 'px system-ui, -apple-system, "Segoe UI", Arial, sans-serif';
	octx.fillStyle = '#fff';
	octx.textAlign = 'center';
	octx.textBaseline = 'middle';
	octx.fillText(text.toUpperCase(), gw / 2, gh / 2);
	const img = octx.getImageData(0, 0, gw, gh).data;
	const cellPx = CELL * S;
	const inPx = Math.round(GAP * S / 2);
	const n = cellPx * cellPx;
	const replace = textReplaceEl.checked;
	for (let c = 0; c < C.W; c++) {
		for (let r = 0; r < C.H; r++) {
			const i = c * C.H + r;
			const x0 = c * PITCH * S + inPx;
			const y0 = r * PITCH * S + inPx;
			let sum = 0;
			for (let py = 0; py < cellPx; py++) {
				let idx = (y0 + py) * gw + x0 * 4 + 3;
				for (let px = 0; px < cellPx; px++, idx += 4) sum += img[idx];
			}
			const cov = sum / (n * 255);
			const lvl = cov < 0.12 ? 0 : Math.min(maxEff, Math.round(cov * maxEff));
			if (replace) grid[i] = lvl;
			else if (lvl > grid[i]) grid[i] = lvl;
		}
	}
}

// ---- storage
const LS_KEY = 'gtm-v1';

function saveNow() {
	try {
		localStorage.setItem(LS_KEY, C.serializeGrid(offset, grid));
	} catch {
		// storage unavailable; app still works
	}
}

function saveSoon() {
	clearTimeout(saveTimer);
	saveTimer = setTimeout(saveNow, 300);
}

function loadSaved() {
	try {
		const s = localStorage.getItem(LS_KEY);
		if (!s) return;
		const p = C.parseGrid(s);
		grid.set(p.grid);
		offset = p.off;
	} catch {
		// corrupt save: start empty
	}
}

// ---- export / import
function doExport() {
	const s = C.serializeGrid(offset, grid);
	downloadGtm(s);
	if (navigator.clipboard) {
		navigator.clipboard.writeText(s)
			.then(() => status('exported: copied ' + s.length + ' chars + downloaded timeplot.gtm'))
			.catch(() => status('exported: downloaded timeplot.gtm'));
	} else {
		status('exported: downloaded timeplot.gtm');
	}
}

function downloadGtm(s) {
	const a = document.createElement('a');
	a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(s);
	a.download = 'timeplot.gtm';
	a.click();
}

function applyImport(text) {
	try {
		const p = C.parseGrid(text);
		pushUndo();
		grid.set(p.grid);
		offset = p.off;
		offsetEl.value = String(offset);
		offsetValEl.textContent = String(offset);
		recomputeDates();
		markDirty();
		status('imported');
	} catch (err) {
		status('import failed: ' + err.message);
	}
}

btnFetch.addEventListener('click', doFetch);
$('btnExport').addEventListener('click', doExport);
$('btnImport').addEventListener('click', () => fileImport.click());
$('btnPaste').addEventListener('click', () => {
	const s = prompt('paste GTM1 string, JSON, or 371 numbers');
	if (s !== null) applyImport(s);
});
fileImport.addEventListener('change', () => {
	const f = fileImport.files[0];
	if (!f) return;
	f.text().then(applyImport, () => status('import failed: cannot read file'));
	fileImport.value = '';
});

// ---- tools / controls
const toolButtons = {
	draw: $('toolDraw'),
	erase: $('toolErase'),
	rect: $('toolRect'),
};

function setTool(t) {
	tool = t;
	for (const k in toolButtons) toolButtons[k].classList.toggle('on', k === t);
}

function setAmount(v) {
	amount = v;
	amountEl.value = String(v);
	amountValEl.textContent = String(v);
}

$('toolDraw').addEventListener('click', () => setTool('draw'));
$('toolErase').addEventListener('click', () => setTool('erase'));
$('toolRect').addEventListener('click', () => setTool('rect'));
amountEl.addEventListener('input', () => setAmount(+amountEl.value));
$('btnFill').addEventListener('click', () => {
	pushUndo();
	grid.fill(amount);
	markDirty();
	status('filled with level ' + amount);
});
$('btnClear').addEventListener('click', () => {
	if (!maxLvl) return;
	if (!confirm('clear the whole grid? (undo works)')) return;
	pushUndo();
	grid.fill(0);
	markDirty();
	status('cleared');
});
$('btnUndo').addEventListener('click', doUndo);
$('btnRender').addEventListener('click', renderText);
textEl.addEventListener('keydown', e => {
	if (e.key === 'Enter') renderText();
});
displayEl.addEventListener('change', () => {
	displayMode = displayEl.value;
	refreshColors();
	scheduleRender();
});
offsetEl.addEventListener('input', () => {
	offset = +offsetEl.value;
	offsetValEl.textContent = String(offset);
	recomputeDates();
	refreshSuggestion();
	scheduleRender();
	saveSoon();
});
lowEl.addEventListener('change', () => {
	low = C.clampInt(+lowEl.value, 0, 999);
	refreshColors();
});
highEl.addEventListener('change', () => {
	high = C.clampInt(+highEl.value, 0, 999);
	refreshColors();
});

window.addEventListener('keydown', e => {
	const tag = e.target && e.target.tagName;
	if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
	if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
		e.preventDefault();
		doUndo();
		return;
	}
	if (e.ctrlKey || e.metaKey || e.altKey) return;
	const k = e.key.toLowerCase();
	if (k >= '1' && k <= '9') setAmount(+k);
	else if (k === '0') setAmount(10);
	else if (k === 'd') setTool('draw');
	else if (k === 'e') setTool('erase');
	else if (k === 'r') setTool('rect');
	else if (k === 'f') $('btnFill').click();
	else if (k === 'c') $('btnClear').click();
});

// ---- legend / suggestion
function refreshLegend() {
	if (!maxLvl) {
		legendEl.innerHTML = '<span class="muted">grid is empty — paint, fill, or render text</span>';
		return;
	}
	let html = '';
	for (let l = 0; l <= maxLvl; l++) {
		const cm = C.commitsForLevel(l, maxLvl, low, high);
		html += '<span><span class="sw" style="background:' + colorCache[l] + '"></span>'
			+ 'L' + l + (l ? ' ≈ ' + cm + ' commits' : ' (none)') + '</span>';
	}
	legendEl.innerHTML = html;
}

function refreshSuggestion() {
	if (todayIdx < 0) {
		suggestEl.innerHTML = 'Today is outside the grid (offset '
			+ (offset > 0 ? '+' : '') + offset + ' w) — shift the offset slider to plan around today.';
		return;
	}
	const lvl = grid[todayIdx];
	const cm = C.commitsForLevel(lvl, maxLvl, low, high);
	let html = '<b>Today · ' + cellLabel[todayIdx] + '</b> · level ' + lvl;
	if (lvl) html += ' → <b>~' + cm + ' commits</b>';
	else html += ' — no commits needed today';

	const y = todayIdx - 1;
	let ys = '<br><span class="muted">Yesterday · ' + cellLabel[y]
		+ ' · planned level ' + grid[y];
	if (grid[y]) ys += ' (~' + C.commitsForLevel(grid[y], maxLvl, low, high) + ' commits)';
	if (actual) ys += ' · actual ' + (actual.get(cellKey[y]) || 0);
	ys += '</span>';
	suggestEl.innerHTML = html + ys;
}

// ---- github sync
function isoDateKey(d) {
	return C.dateKeyOf(d.getTime());
}

function cacheKey(user) {
	return 'gtm-calc-' + user;
}

function cacheActual(user, map) {
	try {
		localStorage.setItem(cacheKey(user), JSON.stringify({ t: Date.now(), m: [...map] }));
	} catch {
		// cache is best-effort
	}
}

function loadActualCache(user) {
	try {
		const s = localStorage.getItem(cacheKey(user));
		if (!s) return null;
		const rec = JSON.parse(s);
		if (Date.now() - rec.t > 6 * 3600e3) return null;
		return new Map(rec.m);
	} catch {
		return null;
	}
}

function toMap(entries) {
	const map = new Map();
	for (const e of entries) {
		if (e.count > 0) map.set(e.date, (map.get(e.date) || 0) + e.count);
	}
	return map;
}

async function fetchGraphQL(user, token) {
	const to = new Date();
	const from = new Date(to.getTime() - 380 * C.DAY);
	const body = JSON.stringify({
		query: 'query($u:String!,$f:DateTime!,$t:DateTime!){user(login:$u){contributionsCollection(from:$f,to:$t){contributionCalendar{weeks{contributions{date count}}}}}}',
		variables: { u: user, f: isoDateKey(from), t: isoDateKey(to) },
	});
	const r = await fetch('https://api.github.com/graphql', {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: 'bearer ' + token },
		body,
	});
	const j = await r.json();
	if (j.errors) throw new Error(j.errors[0].message);
	const cal = j.data && j.data.user && j.data.user.contributionsCollection;
	if (!cal) throw new Error('user not found (or bad token)');
	return { map: toMap(cal.contributionCalendar.weeks.reduce((a, w) => a.concat(w.contributions), [])), note: 'graphql' };
}

async function fetchDeno(user) {
	const r = await fetch('https://github-contributions-api.deno.dev/' + encodeURIComponent(user) + '.json');
	if (!r.ok) throw new Error('contributions api http ' + r.status);
	const j = await r.json();
	if (!Array.isArray(j)) throw new Error('unexpected api shape');
	return { map: toMap(j), note: 'contributions api' };
}

// no-auth fallback: public events, PushEvent.payload.size summed per day (approx)
async function fetchEvents(user) {
	const map = new Map();
	const cutoff = todayMs - 380 * C.DAY;
	let oldest = Infinity;
	for (let page = 1; page <= 3; page++) {
		const r = await fetch('https://api.github.com/users/' + encodeURIComponent(user) + '/events/public?per_page=100&page=' + page);
		if (r.status === 404) throw new Error('user not found');
		if (!r.ok) throw new Error('github api http ' + r.status);
		const arr = await r.json();
		if (!arr.length) break;
		oldest = Date.parse(arr[arr.length - 1].created_at);
		let stop = false;
		for (const ev of arr) {
			if (ev.type !== 'PushEvent') continue;
			const t = Date.parse(ev.created_at);
			if (t < cutoff) {
				stop = true;
				break;
			}
			const k = isoDateKey(new Date(t));
			map.set(k, (map.get(k) || 0) + (ev.payload.size || 1));
		}
		if (stop || oldest < cutoff) break;
	}
	if (!map.size) throw new Error('no recent push events');
	return { map: map, note: 'approx: public push events' };
}

async function doFetch() {
	const user = ghUserEl.value.trim();
	if (!user) {
		status('enter a github username first');
		return;
	}
	btnFetch.disabled = true;
	status('fetching @' + user + ' …');
	try {
		const cached = loadActualCache(user);
		let res;
		if (cached) {
			res = { map: cached, note: 'cache (6h)' };
		} else if (ghTokenEl.value.trim()) {
			res = await fetchGraphQL(user, ghTokenEl.value.trim());
		} else {
			try {
				res = await fetchDeno(user);
			} catch {
				res = await fetchEvents(user);
			}
		}
		actual = res.map;
		cacheActual(user, res.map);
		refreshSuggestion();
		scheduleRender();
		status('synced @' + user + ' · ' + res.map.size + ' days with commits · ' + res.note);
	} catch (err) {
		status('fetch failed: ' + err.message + ' — low/high mapping still works without sync');
	}
	btnFetch.disabled = false;
}

// ---- init
function setupCanvas() {
	const dpr = window.devicePixelRatio || 1;
	canvas.width = LOGICAL_W * dpr;
	canvas.height = LOGICAL_H * dpr;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

setupCanvas();
loadSaved();
offsetEl.value = String(offset);
offsetValEl.textContent = String(offset);
recomputeDates();
refreshColors();
scheduleRender();
status('ready — paint with the pointer, or type text and hit render. autosaves locally.');
