// core.js - pure logic for github-timeplot-message. No DOM; importable from node.

export const W = 53;
export const H = 7;
export const N = W * H;
export const DAY = 86400000;
export const MAX_LEVEL = 10;

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad2(v) {
	return v < 10 ? '0' + v : '' + v;
}

export function clampInt(v, lo, hi) {
	if (Number.isNaN(v)) return lo;
	return v < lo ? lo : v > hi ? hi : v;
}

// ---------------------------------------------------------------- dates

export function localTodayMs(now) {
	const d = now || new Date();
	return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function weekStartSundayMs(ms) {
	const d = new Date(ms);
	d.setDate(d.getDate() - d.getDay());
	return d.getTime();
}

// Grid start (a local Sunday). 53 whole weeks ending on the Saturday of
// (this week + offset). end - 370 days lands on a Sunday because 370 % 7 == 6.
export function gridStartMs(todayMs, offsetWeeks) {
	const end = weekStartSundayMs(todayMs) + (6 + offsetWeeks * 7) * DAY;
	return end - (W * H - 1) * DAY;
}

export function dateKeyOf(ms) {
	const d = new Date(ms);
	return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

// Fills preallocated out arrays (rebuilt once per offset change, not per frame):
//   outKey[i]   'YYYY-MM-DD' local
//   outLabel[i] 'Mon Sep 21, 2026'
//   outMonth[c] month number of column c (for month labels)
// Day walking via Date.setDate keeps DST in check.
export function buildGridDates(todayMs, offsetWeeks, outKey, outLabel, outMonth) {
	const start = gridStartMs(todayMs, offsetWeeks);
	const d = new Date(start);
	let y = d.getFullYear();
	let mo = d.getMonth();
	for (let c = 0; c < W; c++) {
		outMonth[c] = mo;
		let day = d.getDate();
		for (let r = 0; r < H; r++) {
			const i = c * H + r;
			outKey[i] = y + '-' + pad2(mo + 1) + '-' + pad2(day);
			outLabel[i] = WEEKDAYS_SHORT[r] + ' ' + MONTHS_SHORT[mo] + ' ' + day + ', ' + y;
			day++;
			d.setDate(day);
			day = d.getDate();
			mo = d.getMonth();
			y = d.getFullYear();
		}
	}
}

// Index of today's cell, or -1 when the grid does not cover today.
export function todayIndex(outKey, todayMs) {
	const tk = dateKeyOf(todayMs);
	for (let i = 0; i < N; i++) {
		if (outKey[i] === tk) return i;
	}
	return -1;
}

// ---------------------------------------------------------------- levels / color / commits

// Shared normalization (matches draft: 0,1 -> 0,1 ; 0,2,3 -> 0,3/4,1):
//   t(0) = 0, t(L) = (L+1)/(max+1)
export function levelT(level, max) {
	if (level <= 0 || max <= 0) return 0;
	return (level + 1) / (max + 1);
}

export function maxCell(grid) {
	let m = 0;
	for (let i = 0; i < grid.length; i++) if (grid[i] > m) m = grid[i];
	return m;
}

// GitHub light-theme graph anchors, level 0..4.
export const PALETTE = [
	[235, 237, 240], // empty  #ebedf0
	[155, 233, 168], // #9be9a8
	[64, 196, 99],   // #40c463
	[48, 161, 78],   // #30a14e
	[33, 110, 57],   // #216e39
];

// Piecewise-linear across the 5 anchors. Returns the preallocated out rgb triple.
export function rampRGB(t, out) {
	const u = t < 0 ? 0 : t > 1 ? 1 : t;
	const pos = u * 4;
	const i = Math.min(3, Math.floor(pos));
	const f = pos - i;
	const a = PALETTE[i];
	const b = PALETTE[i + 1];
	out[0] = a[0] + (b[0] - a[0]) * f;
	out[1] = a[1] + (b[1] - a[1]) * f;
	out[2] = a[2] + (b[2] - a[2]) * f;
	return out;
}

// CSS color string per level; rebuild only when max or display mode changes.
export function buildColorCache(max, mode) {
	const n = Math.max(1, max);
	const out = new Array(n + 1);
	const rgb = [0, 0, 0];
	for (let l = 0; l <= n; l++) {
		const t = levelT(l, max);
		let r, g, b;
		if (mode === 'quant') {
			// rank-based: level 1 is never "empty", level max is always darkest
			const q = t <= 0 ? 0 : Math.max(1, Math.min(4, Math.round((l / n) * 4)));
			r = PALETTE[q][0]; g = PALETTE[q][1]; b = PALETTE[q][2];
		} else {
			rampRGB(t, rgb);
			r = rgb[0]; g = rgb[1]; b = rgb[2];
		}
		out[l] = 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ')';
	}
	return out;
}

// Level -> commits. Level 0 (background / erased) is `low`, level max is `high`;
// intermediate levels (smooth text) interpolate on the same t(L) as the colors.
export function commitsForLevel(level, max, low, high) {
	if (high < low) high = low;
	return Math.round(low + (high - low) * levelT(level, max));
}

// ---------------------------------------------------------------- mapping recommendation

export const MAP_MAX = 50;      // slider range for low / high (commits per day)
export const MIN_SPREAD = 5;    // drawn days are at least this far above background
export const AVG_DAYS = 90;

const REC_COUNTS = new Int32Array(AVG_DAYS); // scratch for recommendMapping, sorted in place

function sortAsc(a, n) {
	for (let i = 1; i < n; i++) {
		const v = a[i];
		let j = i - 1;
		while (j >= 0 && a[j] > v) {
			a[j + 1] = a[j];
			j--;
		}
		a[j + 1] = v;
	}
}

// Robust low / high from the daily counts of the AVG_DAYS days before todayMs
// (today excluded: still in progress; absent dates count 0). Quantiles instead
// of the mean so spikes and inactive stretches cannot drag the numbers:
//   low  = median day      background keeps the typical rate
//   high = p90 busy day    drawing sits clearly above the day-to-day noise,
//          floored at 2*low / low + MIN_SPREAD so quiet accounts still get a
//          visible picture. Fills out.low/high/med/p90.
export function recommendMapping(map, todayMs, out) {
	const d = new Date(todayMs);
	for (let i = 0; i < AVG_DAYS; i++) {
		d.setDate(d.getDate() - 1);
		REC_COUNTS[i] = map.get(dateKeyOf(d.getTime())) || 0;
	}
	sortAsc(REC_COUNTS, AVG_DAYS);
	out.med = REC_COUNTS[Math.ceil(0.5 * AVG_DAYS) - 1];  // nearest-rank quantiles
	out.p90 = REC_COUNTS[Math.ceil(0.9 * AVG_DAYS) - 1];
	out.low = Math.min(MAP_MAX, out.med);
	out.high = Math.min(MAP_MAX, Math.max(out.p90, out.low * 2, out.low + MIN_SPREAD));
	return out;
}

// ---------------------------------------------------------------- commit plan

// Unmet commits over grid indices [fromIdx, toIdx]. A date missing from the map
// counts as 0 commits: the fetchers cover the whole grid range, so absent
// really means "nothing committed".
export function shortfallOf(grid, cellKey, actualMap, fromIdx, toIdx, max, low, high) {
	let sum = 0;
	if (fromIdx < 0) fromIdx = 0;
	for (let i = fromIdx; i <= toIdx; i++) {
		const target = commitsForLevel(grid[i], max, low, high);
		if (!target) continue;
		const done = actualMap.get(cellKey[i]) || 0;
		if (done < target) sum += target - done;
	}
	return sum;
}

// Fills the caller-owned plan (reused across refreshes, no per-refresh alloc):
//   plan.rows[i] = { key, label, level, target, actual, left, today }, 0 <= i < plan.n
//   plan.n, plan.total, plan.dueDays, plan.shortfall
// Row 0 is today; rows walk forward until `days` or the end of the grid.
// actual = -1 marks "no sync data"; carryDays > 0 adds the shortfall of the
// previous carryDays days to today's `left`. Returns plan.n (0 if today is
// outside the grid, so the caller can show its empty state).
export function buildCommitPlan(grid, cellKey, cellLabel, todayIdx, days, max, low, high, actualMap, carryDays, plan) {
	plan.n = 0;
	plan.total = 0;
	plan.dueDays = 0;
	plan.shortfall = 0;
	if (todayIdx < 0) return 0;
	if (actualMap && carryDays > 0) {
		plan.shortfall = shortfallOf(grid, cellKey, actualMap, todayIdx - carryDays, todayIdx - 1, max, low, high);
	}
	const end = Math.min(todayIdx + days, N, todayIdx + plan.rows.length);
	let n = 0;
	for (let idx = todayIdx; idx < end; idx++, n++) {
		const r = plan.rows[n];
		const level = grid[idx];
		const target = commitsForLevel(level, max, low, high);
		const actual = actualMap ? (actualMap.get(cellKey[idx]) || 0) : -1;
		const done = actual > 0 ? actual : 0;
		r.key = cellKey[idx];
		r.label = cellLabel[idx];
		r.level = level;
		r.target = target;
		r.actual = actual;
		r.left = (target > done ? target - done : 0) + (n === 0 ? plan.shortfall : 0);
		r.today = n === 0 ? 1 : 0;
		plan.total += target;
		if (target > 0) plan.dueDays++;
	}
	plan.n = n;
	return n;
}

// ---------------------------------------------------------------- storage

function b64Encode(bytes) {
	let s = '';
	for (let i = 0; i < bytes.length; i += 0x8000) {
		s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
	}
	return btoa(s);
}

function b64Decode(s) {
	const bin = atob(s);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

// Canonical format: 'GTM1|<offset>|<base64 of Uint8Array(371)>'.
// Max level is derived from data, so nothing else needs to be stored.
export function serializeGrid(offset, grid) {
	return 'GTM1|' + offset + '|' + b64Encode(grid);
}

function fromBytes(off, data) {
	if (data.length !== N) throw new Error('bad data length ' + data.length);
	return { off: clampInt(off, -52, 52), grid: data };
}

// Accepts: GTM1 string, JSON {v,off,data}, or 371 plain numbers.
export function parseGrid(text) {
	text = (text || '').trim();
	if (!text) throw new Error('empty input');
	if (text[0] === '{') {
		const j = JSON.parse(text);
		const off = typeof j.off === 'number' ? j.off : 0;
		const data = typeof j.data === 'string' ? b64Decode(j.data) : new Uint8Array(j.data);
		return fromBytes(off, data);
	}
	const parts = text.split('|');
	if (parts.length === 3 && parts[0] === 'GTM1') {
		return fromBytes(parseInt(parts[1], 10), b64Decode(parts[2]));
	}
	const toks = text.split(/[\s,;]+/).filter(Boolean);
	if (toks.length === N) {
		const g = new Uint8Array(N);
		for (let i = 0; i < N; i++) g[i] = clampInt(parseInt(toks[i], 10), 0, MAX_LEVEL);
		return { off: 0, grid: g };
	}
	throw new Error('unrecognized format');
}

// ---------------------------------------------------------------- bitmap fonts

// Glyph = space-separated row bitmaps, MSB = leftmost pixel, rows top->bottom.
const FONT_5X7 = {
	'A': '01110 10001 10001 11111 10001 10001 10001',
	'B': '11110 10001 10001 11110 10001 10001 11110',
	'C': '01110 10001 10000 10000 10000 10001 01110',
	'D': '11110 10001 10001 10001 10001 10001 11110',
	'E': '11111 10000 10000 11110 10000 10000 11111',
	'F': '11111 10000 10000 11110 10000 10000 10000',
	'G': '01110 10001 10000 10111 10001 10001 01110',
	'H': '10001 10001 10001 11111 10001 10001 10001',
	'I': '01110 00100 00100 00100 00100 00100 01110',
	'J': '00111 00010 00010 00010 00010 10010 01100',
	'K': '10001 10010 10100 11000 10100 10010 10001',
	'L': '10000 10000 10000 10000 10000 10000 11111',
	'M': '10001 11011 10101 10101 10001 10001 10001',
	'N': '10001 11001 10101 10011 10001 10001 10001',
	'O': '01110 10001 10001 10001 10001 10001 01110',
	'P': '11110 10001 10001 11110 10000 10000 10000',
	'Q': '01110 10001 10001 10001 10101 10010 01101',
	'R': '11110 10001 10001 11110 10100 10010 10001',
	'S': '01111 10000 10000 01110 00001 00001 11110',
	'T': '11111 00100 00100 00100 00100 00100 00100',
	'U': '10001 10001 10001 10001 10001 10001 01110',
	'V': '10001 10001 10001 10001 10001 01010 00100',
	'W': '10001 10001 10001 10101 10101 11011 10001',
	'X': '10001 10001 01010 00100 01010 10001 10001',
	'Y': '10001 10001 01010 00100 00100 00100 00100',
	'Z': '11111 00001 00010 00100 01000 10000 11111',
	'0': '01110 10001 10011 10101 11001 10001 01110',
	'1': '00100 01100 00100 00100 00100 00100 01110',
	'2': '01110 10001 00001 00010 00100 01000 11111',
	'3': '11111 00010 00100 00010 00001 10001 01110',
	'4': '00010 00110 01010 10010 11111 00010 00010',
	'5': '11111 10000 11110 00001 00001 10001 01110',
	'6': '00110 01000 10000 11110 10001 10001 01110',
	'7': '11111 00001 00010 00100 01000 01000 01000',
	'8': '01110 10001 10001 01110 10001 10001 01110',
	'9': '01110 10001 10001 01111 00001 00010 01100',
	' ': '00000 00000 00000 00000 00000 00000 00000',
	'.': '00000 00000 00000 00000 00000 01100 01100',
	',': '00000 00000 00000 00000 00000 00110 01100',
	'!': '00100 00100 00100 00100 00100 00000 00100',
	'?': '01110 10001 00001 00010 00100 00000 00100',
	"'": '00110 00110 01000 00000 00000 00000 00000',
	'"': '01010 01010 00000 00000 00000 00000 00000',
	'-': '00000 00000 00000 01110 00000 00000 00000',
	'+': '00000 00000 00100 01110 00100 00000 00000',
	'=': '00000 00000 01110 00000 01110 00000 00000',
	':': '00000 00110 00000 00000 00110 00000 00000',
	';': '00000 00110 00000 00000 00110 01100 00000',
	'@': '01110 10001 10111 10101 10110 10000 01110',
	'#': '01010 01010 11111 01010 11111 01010 01010',
	'<': '00010 00100 01000 10000 01000 00100 00010',
	'>': '01000 00100 00010 00001 00010 00100 01000',
	'/': '00001 00010 00010 00100 01000 01000 10000',
	'\\': '10000 01000 01000 00100 00010 00010 00001',
	'(': '00010 00100 01000 01000 01000 00100 00010',
	')': '01000 00100 00010 00010 00010 00100 01000',
	'_': '00000 00000 00000 00000 00000 00000 11111',
	'|': '00100 00100 00100 00100 00100 00100 00100',
	'~': '00000 00000 00010 01101 10010 00000 00000',
	'*': '00000 10101 01110 10101 00000 00000 00000',
};

const FONT_3X5 = {
	'A': '010 101 111 101 101',
	'B': '110 101 110 101 110',
	'C': '011 100 100 100 011',
	'D': '110 101 101 101 110',
	'E': '111 100 110 100 111',
	'F': '111 100 110 100 100',
	'G': '011 100 101 101 011',
	'H': '101 101 111 101 101',
	'I': '111 010 010 010 111',
	'J': '001 001 001 101 010',
	'K': '101 110 100 110 101',
	'L': '100 100 100 100 111',
	'M': '101 111 111 101 101',
	'N': '101 111 111 111 101',
	'O': '010 101 101 101 010',
	'P': '110 101 110 100 100',
	'Q': '010 101 101 110 011',
	'R': '110 101 110 110 101',
	'S': '011 100 010 001 110',
	'T': '111 010 010 010 010',
	'U': '101 101 101 101 010',
	'V': '101 101 101 010 010',
	'W': '101 101 111 111 101',
	'X': '101 101 010 101 101',
	'Y': '101 101 010 010 010',
	'Z': '111 001 010 100 111',
	'0': '111 101 101 101 111',
	'1': '010 110 010 010 111',
	'2': '110 001 010 100 111',
	'3': '110 001 010 001 110',
	'4': '001 011 101 111 001',
	'5': '111 100 110 001 110',
	'6': '010 100 111 101 010',
	'7': '111 001 010 010 010',
	'8': '010 101 010 101 010',
	'9': '010 101 011 001 110',
	' ': '000 000 000 000 000',
	'.': '000 000 000 000 010',
	',': '000 000 000 010 100',
	'!': '010 010 010 000 010',
	'?': '110 001 010 000 010',
	"'": '010 010 000 000 000',
	'-': '000 000 111 000 000',
	'+': '000 010 111 010 000',
	'=': '000 111 000 111 000',
	':': '000 010 000 010 000',
	';': '000 010 000 010 100',
	'@': '111 101 111 101 001',
	'#': '010 111 010 111 010',
	'(': '001 010 010 010 001',
	')': '100 010 010 010 100',
	'_': '000 000 000 000 111',
	'|': '010 010 010 010 010',
	'/': '001 001 010 100 100',
	'\\': '100 100 010 001 001',
	'*': '101 010 101 000 000',
	'<': '001 010 100 010 001',
	'>': '100 010 001 010 100',
};

function decodeFont(table) {
	const out = {};
	for (const ch in table) {
		const rows = table[ch].split(' ');
		const bits = new Array(rows.length);
		for (let r = 0; r < rows.length; r++) bits[r] = parseInt(rows[r], 2);
		out[ch] = bits;
	}
	return out;
}

// Decoded glyph tables: char -> array of row bitmasks.
export const FONT57 = decodeFont(FONT_5X7);
export const FONT35 = decodeFont(FONT_3X5);

export function glyphFor(font, ch) {
	const c = ch.toUpperCase();
	return font[c] || font['?'];
}

export function textWidth57(str) {
	return str.length ? str.length * 6 - 1 : 0; // advance 5 + 1, no trailing space
}

export function textWidth35(str) {
	return str.length ? str.length * 4 - 1 : 0; // advance 3 + 1, no trailing space
}

// Largest pixel font that renders `text` inside the grid width, or null when
// even 3x5 overflows (caller reports the needed width instead of clipping).
export function pickPixelFont(text) {
	const s = (text || '').trim();
	if (!s) return null;
	if (textWidth57(s) <= W) return '57';
	if (textWidth35(s) <= W) return '35';
	return null;
}

// Writes text into grid (mutates), centered horizontally, at `level`.
// font: '57' | '35'. Returns {x0, y0, w} of the placed block.
export function renderTextPixel(grid, text, font, level) {
	const table = font === '35' ? FONT35 : FONT57;
	const cw = font === '35' ? 3 : 5;
	const ch = font === '35' ? 5 : 7;
	const adv = cw + 1;
	const y0 = font === '35' ? 1 : 0;
	const str = text.toUpperCase();
	const w = str.length ? str.length * adv - 1 : 0;
	let x0 = Math.floor((W - w) / 2);
	if (x0 < 0) x0 = 0;
	for (let gi = 0; gi < str.length; gi++) {
		const glyph = glyphFor(table, str[gi]);
		const gx = x0 + gi * adv;
		for (let r = 0; r < ch; r++) {
			const bits = glyph[r];
			for (let c = 0; c < cw; c++) {
				if (bits & (1 << (cw - 1 - c))) {
					const x = gx + c;
					if (x >= 0 && x < W) grid[x * H + (y0 + r)] = level;
				}
			}
		}
	}
	return { x0: x0, y0: y0, w: w };
}
