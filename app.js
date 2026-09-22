// app.js - DOM, canvas and events for github-timeplot-message. Pure logic lives in core.js.
import * as C from './core.js';

// ---- dom refs
const $ = id => document.getElementById(id);
const canvas = $('plot');
const ctx = canvas.getContext('2d');
const plotWrap = $('plotWrap');
const tip = $('tip');
const track = $('track');
const trackCtx = track.getContext('2d');
const trackWrap = $('trackWrap');
const trackLabel = $('trackLabel');
const rangeEl = $('range');
const suggestEl = $('suggest');
const legendEl = $('legend');
const statusEl = $('status');
const textEl = $('text');
const textFontEl = $('textFont');
const textReplaceEl = $('textReplace');
const offsetValEl = $('offsetVal');
const lowEl = $('low');
const lowValEl = $('lowVal');
const highEl = $('high');
const highValEl = $('highVal');
const displayEl = $('display');
const ghUserEl = $('ghUser');
const ghTokenEl = $('ghToken');
const btnFetch = $('btnFetch');
const fileImport = $('fileImport');
const btnPng = $('btnPng');
const planEl = $('plan');
const planSummaryEl = $('planSummary');
const planDaysEl = $('planDays');
const planCarryEl = $('planCarry');

// ---- canvas geometry (logical px; backing store scaled by DPR)
const LABEL_W = 30;
const LABEL_H = 18;
const CELL = 16;
const GAP = 3;
const PITCH = CELL + GAP;
const LOGICAL_W = LABEL_W + C.W * PITCH;
const LOGICAL_H = LABEL_H + C.H * PITCH;
const INSET = GAP / 2;

// track slider geometry (aligned to plot columns)
const TRACK_H = 40;
const TRACK_INSET = LABEL_W;
const TRACK_USABLE = LOGICAL_W - TRACK_INSET; // = C.W * PITCH
const OFFSET_MIN = -52;
const OFFSET_MAX = 52;
const TRACK_BAR_Y = 18;
const TRACK_BAR_H = 6;
const TRACK_THUMB_W = 12;
const TRACK_THUMB_H = 22;

const EMPTY_COLOR = 'rgb(235,237,240)';
const FUTURE_COLOR = 'rgba(209,213,219,0.4)';
const DOT_COLOR = 'rgb(212,167,44)';
const LABEL_COLOR = '#57606a';
const TRACK_BAR_COLOR = '#d0d7de';
const TRACK_FILL_COLOR = '#216e39';
const TRACK_THUMB_COLOR = '#1f2328';
const TRACK_TODAY_COLOR = '#57606a';

// ---- state
const grid = new Uint8Array(C.N);
// Fresh sessions center today (column = 52 - offset); saved sessions restore
// their own offset in loadSaved().
let offset = 26;
let tool = 'draw';
let displayMode = 'grad';
let low = 0;                // commits on background (level 0) days
let high = 10;              // commits on drawn (level max) days
let maxLvl = 0;
let colorCache = C.buildColorCache(0, displayMode);
let actual = null;          // Map<dateKey, count> | null
let drawing = false;
let dragA = -1;
let dragB = -1;
let lastPaint = -1;
let saveTimer = 0;
let renderQueued = false;
let trackRenderQueued = false;
let trackDragging = false;
let trackHover = false;
let trackHoverX = -1;
const undoStack = [];
const todayMs = C.localTodayMs();

// commit plan: rows are preallocated (max 30 days) and mutated in place; the
// chips are DOM nodes built once per row-count change and then only rewritten.
const CARRY_DAYS = 7;
const PLAN_MAX_DAYS = 30;
let planDays = 14;
const plan = { rows: [], n: 0, total: 0, dueDays: 0, shortfall: 0 };
for (let i = 0; i < PLAN_MAX_DAYS; i++) {
	plan.rows.push({ key: '', label: '', level: 0, target: 0, actual: -1, left: 0, today: 0 });
}
const planChips = [];
const recommended = { low: 0, high: 0, med: 0, p90: 0 };

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

function scheduleTrackRender() {
	if (trackRenderQueued) return;
	trackRenderQueued = true;
	requestAnimationFrame(() => {
		trackRenderQueued = false;
		drawTrack();
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
	refreshPlan();
}

// grid (or offset via caller) changed
function markDirty() {
	refreshColors();
	scheduleRender();
	scheduleTrackRender();
	saveSoon();
}

// drawn cells always take the top level: hand-drawn pictures are two-tone,
// shades only come from smooth text.
function drawLevel() {
	return maxLvl || 1;
}

// ---- low / high mapping (single source of truth)
// `from` names the slider the user moved so the other one yields (high >= low).
function setMapping(lo, hi, from) {
	lo = C.clampInt(lo | 0, 0, C.MAP_MAX);
	hi = C.clampInt(hi | 0, 0, C.MAP_MAX);
	if (hi < lo) {
		if (from === 'low') hi = lo;
		else lo = hi;
	}
	low = lo;
	high = hi;
	lowEl.value = String(lo);
	highEl.value = String(hi);
	lowValEl.textContent = String(lo);
	highValEl.textContent = String(hi);
	refreshColors();
	saveMappingSoon();
}

// ---- offset (single source of truth)
function setOffset(v, opts) {
	const o = C.clampInt(v | 0, OFFSET_MIN, OFFSET_MAX);
	if (o === offset && !(opts && opts.force)) return;
	offset = o;
	offsetValEl.textContent = (offset > 0 ? '+' : '') + offset;
	recomputeDates();
	refreshSuggestion();
	refreshPlan();
	scheduleRender();
	scheduleTrackRender();
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
		setOffset(s.off);
	}
	refreshColors();
	scheduleRender();
	scheduleTrackRender();
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

// ---- track slider
// The track mirrors the plot's motion, not the timeline: dragging the thumb
// right shifts the plot's dates (and the today cell) right, same as scrolling
// the plot down. So offset +52 (grid pushed into the future) sits at the left
// end, -52 at the right end.
function offsetToX(o) {
	return TRACK_INSET + (OFFSET_MAX - o) / (OFFSET_MAX - OFFSET_MIN) * TRACK_USABLE;
}

function xToOffset(x) {
	const u = (x - TRACK_INSET) / TRACK_USABLE;
	return Math.round(OFFSET_MAX - u * (OFFSET_MAX - OFFSET_MIN));
}

function drawTrack() {
	trackCtx.clearRect(0, 0, LOGICAL_W, TRACK_H);

	// background bar
	trackCtx.fillStyle = TRACK_BAR_COLOR;
	trackCtx.fillRect(TRACK_INSET, TRACK_BAR_Y, TRACK_USABLE, TRACK_BAR_H);

	// filled portion (the range currently covered by the grid, relative to today)
	const todayX = offsetToX(0);
	const thumbX = offsetToX(offset);
	trackCtx.fillStyle = TRACK_FILL_COLOR;
	if (offset >= 0) {
		trackCtx.fillRect(todayX, TRACK_BAR_Y, thumbX - todayX, TRACK_BAR_H);
	} else {
		trackCtx.fillRect(thumbX, TRACK_BAR_Y, todayX - thumbX, TRACK_BAR_H);
	}

	// quarter-year tick marks
	trackCtx.strokeStyle = '#8b949e';
	trackCtx.lineWidth = 1;
	for (let o = -52; o <= 52; o += 13) {
		const x = offsetToX(o);
		trackCtx.beginPath();
		trackCtx.moveTo(x + 0.5, TRACK_BAR_Y + TRACK_BAR_H + 1);
		trackCtx.lineTo(x + 0.5, TRACK_BAR_Y + TRACK_BAR_H + 4);
		trackCtx.stroke();
	}

	// end labels (+52w on the left = grid pushed into the future, -52w right)
	trackCtx.fillStyle = TRACK_TODAY_COLOR;
	trackCtx.font = '10px system-ui, sans-serif';
	trackCtx.textBaseline = 'top';
	trackCtx.textAlign = 'left';
	trackCtx.fillText('+52w', TRACK_INSET, TRACK_BAR_Y + TRACK_BAR_H + 5);
	trackCtx.textAlign = 'right';
	trackCtx.fillText('-52w', TRACK_INSET + TRACK_USABLE, TRACK_BAR_Y + TRACK_BAR_H + 5);

	// today marker at offset 0
	trackCtx.strokeStyle = TRACK_TODAY_COLOR;
	trackCtx.lineWidth = 1.5;
	trackCtx.beginPath();
	trackCtx.moveTo(todayX + 0.5, TRACK_BAR_Y - 4);
	trackCtx.lineTo(todayX + 0.5, TRACK_BAR_Y + TRACK_BAR_H + 4);
	trackCtx.stroke();
	trackCtx.fillStyle = TRACK_TODAY_COLOR;
	trackCtx.textAlign = 'center';
	trackCtx.fillText('today', todayX, 4);

	// hover guide line
	if ((trackHover || trackDragging) && trackHoverX >= 0) {
		trackCtx.strokeStyle = 'rgba(31,35,40,0.5)';
		trackCtx.lineWidth = 1;
		trackCtx.setLineDash([2, 2]);
		trackCtx.beginPath();
		trackCtx.moveTo(trackHoverX + 0.5, TRACK_BAR_Y - 6);
		trackCtx.lineTo(trackHoverX + 0.5, TRACK_BAR_Y + TRACK_BAR_H + 6);
		trackCtx.stroke();
		trackCtx.setLineDash([]);
	}

	// thumb
	const ty = TRACK_BAR_Y + TRACK_BAR_H / 2 - TRACK_THUMB_H / 2;
	trackCtx.fillStyle = TRACK_THUMB_COLOR;
	roundRect(trackCtx, thumbX - TRACK_THUMB_W / 2, ty, TRACK_THUMB_W, TRACK_THUMB_H, 3);
	trackCtx.fill();
	trackCtx.fillStyle = '#fff';
	trackCtx.fillRect(thumbX - 1, ty + 5, 2, TRACK_THUMB_H - 10);
}

function roundRect(c, x, y, w, h, r) {
	c.beginPath();
	c.moveTo(x + r, y);
	c.lineTo(x + w - r, y);
	c.quadraticCurveTo(x + w, y, x + w, y + r);
	c.lineTo(x + w, y + h - r);
	c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
	c.lineTo(x + r, y + h);
	c.quadraticCurveTo(x, y + h, x, y + h - r);
	c.lineTo(x, y + r);
	c.quadraticCurveTo(x, y, x + r, y);
	c.closePath();
}

function setupTrackCanvas() {
	const dpr = window.devicePixelRatio || 1;
	track.width = LOGICAL_W * dpr;
	track.height = TRACK_H * dpr;
	trackCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function trackXFromEvent(e) {
	const rect = track.getBoundingClientRect();
	return (e.clientX - rect.left) * LOGICAL_W / rect.width;
}

function showTrackLabel(x) {
	const o = xToOffset(x);
	const start = C.dateKeyOf(C.gridStartMs(todayMs, o));
	const end = C.dateKeyOf(C.gridStartMs(todayMs, o) + 370 * C.DAY);
	trackLabel.textContent = (o > 0 ? '+' : '') + o + 'w · ' + start + ' → ' + end;
	const wrap = plotWrap.getBoundingClientRect();
	const rect = track.getBoundingClientRect();
	const scale = rect.width / LOGICAL_W;
	trackLabel.style.left = (rect.left - wrap.left + x * scale) + 'px';
	trackLabel.style.top = (rect.top - wrap.top - 2) + 'px';
	trackLabel.hidden = false;
}

function hideTrackLabel() {
	trackLabel.hidden = true;
}

track.addEventListener('pointerdown', e => {
	e.preventDefault();
	const x = trackXFromEvent(e);
	track.setPointerCapture(e.pointerId);
	trackDragging = true;
	trackHoverX = x;
	setOffset(xToOffset(x));
	showTrackLabel(x);
	scheduleTrackRender();
});

track.addEventListener('pointermove', e => {
	const x = trackXFromEvent(e);
	trackHoverX = x;
	trackHover = true;
	if (trackDragging) {
		setOffset(xToOffset(x));
	}
	showTrackLabel(x);
	scheduleTrackRender();
});

function endTrackDrag() {
	if (!trackDragging) return;
	trackDragging = false;
	scheduleTrackRender();
}

track.addEventListener('pointerup', endTrackDrag);
track.addEventListener('pointercancel', endTrackDrag);
track.addEventListener('pointerleave', () => {
	trackHover = false;
	if (!trackDragging) hideTrackLabel();
	scheduleTrackRender();
});

track.addEventListener('keydown', e => {
	const k = e.key;
	// spatial keys: right / End move the thumb right, which plans earlier
	let o = offset;
	if (k === 'ArrowLeft') o += e.shiftKey ? 4 : 1;
	else if (k === 'ArrowRight') o -= e.shiftKey ? 4 : 1;
	else if (k === 'PageUp') o += 13;
	else if (k === 'PageDown') o -= 13;
	else if (k === 'Home') o = OFFSET_MAX;
	else if (k === 'End') o = OFFSET_MIN;
	else return;
	e.preventDefault();
	setOffset(o);
});

// wheel scrubs offset: scroll down (deltaY > 0) moves into the past (offset decreases)
let wheelAcc = 0;
function onWheel(e) {
	if (e.deltaY === 0) return;
	wheelAcc += e.deltaY;
	const step = 19; // pixels per week
	if (Math.abs(wheelAcc) < step) return;
	const weeks = Math.trunc(wheelAcc / step);
	wheelAcc -= weeks * step;
	if (weeks === 0) return;
	e.preventDefault();
	setOffset(offset - weeks);
}
canvas.addEventListener('wheel', onWheel, { passive: false });
track.addEventListener('wheel', onWheel, { passive: false });

// ---- commit plan panel
function ensurePlanChips(n) {
	if (planChips.length === n) return;
	for (const chip of planChips) chip.el.remove();
	planChips.length = 0;
	for (let i = 0; i < n; i++) {
		const el = document.createElement('div');
		el.className = 'pd';
		const date = document.createElement('b');
		const lvl = document.createElement('span');
		lvl.className = 'lvl';
		const st = document.createElement('span');
		st.className = 'st';
		el.appendChild(date);
		el.appendChild(lvl);
		el.appendChild(st);
		planEl.appendChild(el);
		planChips.push({ el: el, date: date, lvl: lvl, st: st, key: '' });
	}
}

function planStatusText(r) {
	if (r.target === 0) return r.actual > 0 ? 'rest · ' + r.actual + ' done' : 'rest';
	if (r.actual < 0) return 'planned';
	if (r.left === 0) return 'done ✓';
	if (r.actual > 0) return r.actual + ' done · ' + r.left + ' left';
	return r.left + ' left';
}

function updatePlanChip(chip, r) {
	if (chip.key !== r.key) {
		chip.key = r.key;
		chip.el.setAttribute('data-key', r.key);
		chip.date.textContent = (r.today ? 'today · ' : '') + r.label.slice(0, 10);
	}
	chip.lvl.textContent = 'L' + r.level + ' · ' + r.target + (r.target === 1 ? ' commit' : ' commits');
	chip.st.textContent = planStatusText(r);
	const met = r.actual >= 0 && r.target > 0 && r.left === 0;
	chip.el.className = 'pd'
		+ (r.today ? ' today' : '')
		+ (met ? ' met' : '')
		+ (r.target === 0 ? ' rest' : r.today && r.left > 0 ? ' due' : '');
	chip.el.title = 'plan ' + r.target + ' commits'
		+ (r.today && plan.shortfall ? ' + ' + plan.shortfall + ' carried from the last ' + CARRY_DAYS + ' days' : '');
}

function refreshPlan() {
	const n = C.buildCommitPlan(grid, cellKey, cellLabel, todayIdx, planDays, maxLvl, low, high,
		actual, planCarryEl.checked ? CARRY_DAYS : 0, plan);
	ensurePlanChips(n);
	for (let i = 0; i < n; i++) updatePlanChip(planChips[i], plan.rows[i]);
	if (!n) {
		planSummaryEl.textContent = 'today is outside the grid — move the offset so today is visible.';
		return;
	}
	planSummaryEl.textContent = plan.n + (plan.n === 1 ? ' day · ' : ' days · ')
		+ (plan.total ? plan.total + ' commits on ' + plan.dueDays + (plan.dueDays === 1 ? ' day' : ' days') : 'nothing planned')
		+ (plan.shortfall > 0 ? ' · behind ' + plan.shortfall + ' over the last ' + CARRY_DAYS + ' days' : '');
}

planDaysEl.addEventListener('change', () => {
	planDays = C.clampInt(parseInt(planDaysEl.value, 10), 1, PLAN_MAX_DAYS);
	refreshPlan();
});
planCarryEl.addEventListener('change', refreshPlan);

// ---- pointer (plot)
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
	const v = tool === 'erase' ? 0 : drawLevel();
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
		fillRectCells(dragA, dragB >= 0 ? dragB : dragA, drawLevel());
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
	const auto = textFontEl.value === 'auto';
	const font = auto ? C.pickPixelFont(text) : textFontEl.value;
	if (!font) {
		status('text too wide: "' + text.trim() + '" needs ' + C.textWidth35(text.trim())
			+ ' columns in 3x5, the grid has ' + C.W + ' — shorten it');
		return;
	}
	pushUndo();
	if (font === 'smooth') {
		smoothText(text, textReplaceEl.checked);
	} else {
		const lvl = drawLevel();
		if (textReplaceEl.checked) grid.fill(0);
		C.renderTextPixel(grid, text, font, lvl);
	}
	markDirty();
	status('rendered text' + (auto && font !== 'smooth' ? ' (' + (font === '57' ? '5x7' : '3x5') + ' auto)' : ''));
}

// antialiased: 4x offscreen bold text, per-cell average alpha -> level.
// replace = overwrite the grid, false = merge (max, keeps background noise).
function smoothText(text, replace) {
	const S = 4;
	const gw = C.W * PITCH * S;
	const gh = C.H * PITCH * S;
	const off = document.createElement('canvas');
	off.width = gw;
	off.height = gh;
	const octx = off.getContext('2d', { willReadFrequently: true });
	const maxEff = Math.max(maxLvl, 4);
	const str = text.toUpperCase();
	// fit + center on the measured ink bounding box, not the em box: works for
	// caps, lowercase and descenders in any font, no hard-coded cap-height guess
	octx.font = '900 100px system-ui, -apple-system, "Segoe UI", Arial, sans-serif';
	const m = octx.measureText(str);
	const w100 = m.width || 1;
	const h100 = (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) || 100;
	const fs = Math.min(gw * 0.96 / w100 * 100, gh * 0.94 / h100 * 100);
	octx.font = '900 ' + fs + 'px system-ui, -apple-system, "Segoe UI", Arial, sans-serif';
	const b = octx.measureText(str);
	octx.fillStyle = '#fff';
	octx.textAlign = 'center';
	octx.textBaseline = 'alphabetic';
	octx.fillText(str, gw / 2, (gh + b.actualBoundingBoxAscent - b.actualBoundingBoxDescent) / 2);
	const img = octx.getImageData(0, 0, gw, gh).data;
	const cellPx = CELL * S;
	const inPx = Math.round(GAP * S / 2);
	const n = cellPx * cellPx;
	for (let c = 0; c < C.W; c++) {
		for (let r = 0; r < C.H; r++) {
			const i = c * C.H + r;
			const x0 = c * PITCH * S + inPx;
			const y0 = r * PITCH * S + inPx;
			let sum = 0;
			for (let py = 0; py < cellPx; py++) {
				// pixel (x, y) -> byte (y * gw + x) * 4 + 3; the y stride must be
				// scaled too or the sampler reads the top quarter of the bitmap
				let idx = ((y0 + py) * gw + x0) * 4 + 3;
				for (let px = 0; px < cellPx; px++, idx += 4) sum += img[idx];
			}
			const cov = sum / (n * 255);
			// contrast stretch: below COV_LO is background, above COV_HI a solid
			// stroke - thin antialiased edges survive, but stems get a crisp
			// top-level core instead of a washed-out mid-level blur
			const snap = cov < 0.16 ? 0 : Math.min(1, (cov - 0.16) / 0.46);
			const lvl = snap <= 0 ? 0 : Math.min(maxEff, Math.max(1, Math.round(snap * maxEff)));
			if (replace) grid[i] = lvl;
			else if (lvl > grid[i]) grid[i] = lvl;
		}
	}
}

// ---- storage
const LS_KEY = 'gtm-v1';
const LS_MAP_KEY = 'gtm-map-v1';
let mapSaveTimer = 0;

function saveMappingSoon() {
	clearTimeout(mapSaveTimer);
	mapSaveTimer = setTimeout(() => {
		try {
			localStorage.setItem(LS_MAP_KEY, low + '|' + high);
		} catch {
			// storage unavailable; app still works
		}
	}, 300);
}

function loadMapping() {
	try {
		const s = localStorage.getItem(LS_MAP_KEY);
		if (!s) return;
		const parts = s.split('|');
		low = C.clampInt(parseInt(parts[0], 10), 0, C.MAP_MAX);
		high = C.clampInt(parseInt(parts[1], 10), low, C.MAP_MAX);
	} catch {
		// corrupt save: keep defaults
	}
}

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
		setOffset(p.off);
		markDirty();
		status('imported');
	} catch (err) {
		status('import failed: ' + err.message);
	}
}

btnFetch.addEventListener('click', doFetch);
$('btnExport').addEventListener('click', doExport);
btnPng.addEventListener('click', doExportPng);
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

// ---- PNG export
function renderGridToCtx(targetCtx, scale) {
	const w = LOGICAL_W * scale;
	const h = (LABEL_H + C.H * PITCH) * scale;
	targetCtx.fillStyle = '#ffffff';
	targetCtx.fillRect(0, 0, w, h);

	targetCtx.fillStyle = LABEL_COLOR;
	targetCtx.font = (11 * scale) + 'px system-ui, sans-serif';
	targetCtx.textBaseline = 'middle';
	for (let c = 0; c < C.W; c++) {
		const t = monthText[c];
		if (t) targetCtx.fillText(t, (LABEL_W + c * PITCH) * scale, (LABEL_H / 2) * scale);
	}
	targetCtx.fillText('Mon', 4 * scale, (LABEL_H + 1 * PITCH + CELL / 2) * scale);
	targetCtx.fillText('Wed', 4 * scale, (LABEL_H + 3 * PITCH + CELL / 2) * scale);
	targetCtx.fillText('Fri', 4 * scale, (LABEL_H + 5 * PITCH + CELL / 2) * scale);

	const cs = CELL * scale, gs = GAP * scale, ps = PITCH * scale, is = INSET * scale;
	const ls = LABEL_H * scale, ws = LABEL_W * scale;
	for (let c = 0; c < C.W; c++) {
		const x = ws + c * ps + is;
		for (let r = 0; r < C.H; r++) {
			const i = c * C.H + r;
			const lvl = grid[i];
			if (lvl) targetCtx.fillStyle = colorCache[lvl];
			else if (isFuture[i]) targetCtx.fillStyle = FUTURE_COLOR;
			else targetCtx.fillStyle = EMPTY_COLOR;
			targetCtx.fillRect(x, ls + r * ps + is, cs, cs);
		}
	}
}

function doExportPng() {
	const SCALE = 2;
	const out = document.createElement('canvas');
	out.width = LOGICAL_W * SCALE;
	out.height = LOGICAL_H * SCALE;
	const octx = out.getContext('2d');
	octx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
	renderGridToCtx(octx, 1);
	let url;
	try {
		url = out.toDataURL('image/png');
	} catch (err) {
		status('PNG export failed: ' + err.message);
		return;
	}
	const start = cellKey[0];
	const end = cellKey[C.N - 1];
	const a = document.createElement('a');
	a.href = url;
	a.download = 'timeplot-' + start + '-' + end + '.png';
	a.click();
	status('exported: ' + a.download);
}

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

$('toolDraw').addEventListener('click', () => setTool('draw'));
$('toolErase').addEventListener('click', () => setTool('erase'));
$('toolRect').addEventListener('click', () => setTool('rect'));
$('btnFill').addEventListener('click', () => {
	pushUndo();
	grid.fill(drawLevel());
	markDirty();
	status('filled');
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
lowEl.addEventListener('input', () => setMapping(+lowEl.value, high, 'low'));
highEl.addEventListener('input', () => setMapping(low, +highEl.value, 'high'));

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
	if (k === 'd') setTool('draw');
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
			+ 'L' + l + (l ? '' : ' background') + (cm ? ' ≈ ' + cm + ' commits' : ' (none)') + '</span>';
	}
	legendEl.innerHTML = html;
}

function refreshSuggestion() {
	if (todayIdx < 0) {
		suggestEl.innerHTML = 'Today is outside the grid (offset '
			+ (offset > 0 ? '+' : '') + offset + ' w) — drag the bar below the grid to plan around today.';
		return;
	}
	const lvl = grid[todayIdx];
	const cm = C.commitsForLevel(lvl, maxLvl, low, high);
	let html = '<b>Today · ' + cellLabel[todayIdx] + '</b> · level ' + lvl;
	if (cm) html += ' → <b>~' + cm + ' commits</b>' + (lvl ? '' : ' (background)');
	else html += ' — no commits needed today';

	const y = todayIdx - 1;
	const ycm = C.commitsForLevel(grid[y], maxLvl, low, high);
	let ys = '<br><span class="muted">Yesterday · ' + cellLabel[y]
		+ ' · planned level ' + grid[y];
	if (ycm) ys += ' (~' + ycm + ' commits)';
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
		C.recommendMapping(res.map, todayMs, recommended);
		setMapping(recommended.low, recommended.high, 'fetch'); // refreshes suggestion + plan
		scheduleRender();
		status('synced @' + user + ' · ' + res.map.size + ' days with commits · ' + res.note
			+ ' · med ' + recommended.med + ', p90 ' + recommended.p90 + ' (90 d) → low ' + low + ', high ' + high);
	} catch (err) {
		status('fetch failed: ' + err.message + ' — low/high mapping still works without sync');
	}
	btnFetch.disabled = false;
}

// ---- demo (simulated fetch + painted picture, e.g. for the README screenshot)
const DEMO_OFFSET = 26;  // today on the center column (52 - offset)
const DEMO_LOW = 5;
const DEMO_HIGH = 10;

$('btnDemo').addEventListener('click', () => {
	pushUndo();
	setOffset(DEMO_OFFSET);
	// typical quiet account: sparse light-green days, weekday-weighted, in slow
	// busy-season waves; kept light (level 1 only) so the text pops. Seeded LCG
	// so the picture (e.g. the README screenshot) is reproducible.
	let seed = 0x2f6e2b1;
	grid.fill(0);
	for (let c = 0; c < C.W; c++) {
		const wave = 0.5 + 0.5 * Math.sin(c * 0.55 + 1.3);
		for (let r = 0; r < C.H; r++) {
			seed = (seed * 1664525 + 1013904223) >>> 0;
			const dice = seed >>> 24; // 0..255
			const base = (r === 0 || r === 6) ? 6 : 16;
			if (dice < base * (0.35 + wave)) grid[c * C.H + r] = 1;
		}
	}
	maxLvl = C.maxCell(grid);
	textEl.value = 'hello world';
	textFontEl.value = 'smooth';
	smoothText('hello world', false); // merge: noise stays between the glyphs
	setMapping(DEMO_LOW, DEMO_HIGH, 'fetch');
	markDirty();
	status('demo: typical background + smooth "hello world" · low 5 / high 10, like a fetched recommendation');
});

// ---- init
function setupCanvas() {
	const dpr = window.devicePixelRatio || 1;
	canvas.width = LOGICAL_W * dpr;
	canvas.height = LOGICAL_H * dpr;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

setupCanvas();
setupTrackCanvas();
loadSaved();
loadMapping();
setOffset(offset, { force: true });
setMapping(low, high, 'load');
scheduleRender();
scheduleTrackRender();
status('ready — paint with the pointer, or type text and hit render. autosaves locally.');
