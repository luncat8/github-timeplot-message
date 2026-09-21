// experiments/core-test.js - plain-node assertions for core.js
// run: node experiments/core-test.js

import * as C from '../core.js';

let failures = 0;
function ok(cond, msg) {
	if (cond) {
		console.log('  ok - ' + msg);
	} else {
		failures++;
		console.log('FAIL - ' + msg);
	}
}
function eq(a, b, msg) {
	ok(a === b, msg + '  (got ' + a + ', want ' + b + ')');
}

// ---- shape
eq(C.N, 371, 'N = 371');
eq(C.W * C.H, 371, 'W*H = 371');

// ---- date math
// Fixed "today": 2026-09-21 is a Monday.
const today = new Date(2026, 8, 21);
const todayMs = today.getTime();
eq(new Date(todayMs).getDay(), 1, '2026-09-21 is Monday (sanity)');

const start0 = C.gridStartMs(todayMs, 0);
eq(new Date(start0).getDay(), 0, 'grid start is a Sunday');
eq(C.dateKeyOf(start0), '2025-09-21', 'offset 0 starts 2025-09-21 (53 weeks ending this week)');
// last cell = Saturday of this week
const lastKey = C.dateKeyOf(start0 + 370 * C.DAY);
eq(lastKey, '2026-09-26', 'offset 0 ends Saturday 2026-09-26');

const start1 = C.gridStartMs(todayMs, 1);
eq(start1 - start0, 7 * C.DAY, 'offset +1 shifts exactly one week');
eq(C.dateKeyOf(start1 + 370 * C.DAY), '2026-10-03', 'offset +1 ends 2026-10-03');
eq(C.dateKeyOf(C.gridStartMs(todayMs, -1) + 370 * C.DAY), '2026-09-19', 'offset -1 ends 2026-09-19');

// buildGridDates fills keys/labels; today index correct
const keys = new Array(C.N);
const labels = new Array(C.N);
const months = new Array(C.W);
C.buildGridDates(todayMs, 0, keys, labels, months);
eq(keys[0], '2025-09-21', 'cell 0 key');
eq(C.todayIndex(keys, todayMs), 365, 'today index = 365 (Mon of last column)');
eq(C.dateKeyOf(new Date(2020, 1, 29).getTime()), '2020-02-29', 'dateKey handles leap day');
// DST crossing (US spring forward 2026-03-08) in the grid window:
// consecutive cell keys must be consecutive local calendar days
const dstToday = new Date(2026, 2, 9); // Monday after US DST
C.buildGridDates(dstToday.getTime(), 0, keys, labels, months);
let consecBad = 0;
for (let i = 1; i < C.N; i++) {
	const a = new Date(keys[i - 1] + 'T00:00:00');
	const b = new Date(keys[i] + 'T00:00:00');
	b.setDate(b.getDate() - 1);
	if (b.getTime() !== a.getTime()) consecBad++;
}
eq(consecBad, 0, 'cell keys are consecutive local days across DST (2026-03 window)');
eq(labels[365], 'Mon Mar 9, 2026', 'label at today index: ' + labels[365]);

// ---- normalization t(L) = (L+1)/(max+1)
eq(C.levelT(1, 1), 1, 't(1, max=1) = 1 (draft: 0,1 -> 0,255)');
eq(C.levelT(2, 3), 0.75, 't(2, max=3) = 3/4 (draft: 255/4*3)');
eq(C.levelT(3, 3), 1, 't(3, max=3) = 1');
eq(C.levelT(0, 4), 0, 't(0) = 0');
eq(C.levelT(5, 0), 0, 't with max=0 = 0');

// ---- palette / ramp
eq(C.PALETTE[0].join(','), '235,237,240', 'anchor 0 #ebedf0');
eq(C.PALETTE[4].join(','), '33,110,57', 'anchor 4 #216e39');
const rgb = [0, 0, 0];
C.rampRGB(1, rgb);
eq(rgb.join(','), '33,110,57', 'ramp(1) = darkest green');
C.rampRGB(0, rgb);
eq(rgb.join(','), '235,237,240', 'ramp(0) = empty color');
C.rampRGB(0.5, rgb);
eq(rgb.join(','), '64,196,99', 'ramp(0.5) = anchor 2 exactly');
C.rampRGB(0.625, rgb);
eq(rgb.join(','), '56,178.5,88.5', 'ramp(0.625) mid-way between anchors 2 and 3');

const cache = C.buildColorCache(4, 'grad');
eq(cache.length, 5, 'color cache length = max+1');
eq(cache[0], 'rgb(235,237,240)', 'cache[0] empty color');
eq(cache[4], 'rgb(33,110,57)', 'cache[max] darkest');
const qcache = C.buildColorCache(4, 'quant');
eq(qcache[1], 'rgb(155,233,168)', 'quant L1 -> #9be9a8');
eq(qcache[2], 'rgb(64,196,99)', 'quant L2 -> #40c463');

// ---- commits
eq(C.commitsForLevel(0, 4, 1, 10), 0, 'level 0 -> 0 commits');
eq(C.commitsForLevel(4, 4, 1, 10), 10, 'level=max -> high');
eq(C.commitsForLevel(1, 4, 1, 10), 5, 'level 1/4 -> 1+9*0.4 = 4.6 -> 5');
eq(C.commitsForLevel(1, 1, 1, 10), 10, 'max=1: only level is high');
let mono = true;
let prev = 0;
for (let l = 1; l <= 10; l++) {
	const v = C.commitsForLevel(l, 10, 1, 10);
	if (v < prev) mono = false;
	prev = v;
}
ok(mono, 'commits monotone in level (max=10)');
eq(C.commitsForLevel(10, 10, 1, 10), 10, 'level 10/10 -> high');

// ---- commit plan
const pkeys = new Array(C.N);
const plabels = new Array(C.N);
const pmonths = new Array(C.W);
C.buildGridDates(todayMs, 0, pkeys, plabels, pmonths);
const ti = C.todayIndex(pkeys, todayMs);
eq(ti, 365, 'plan: today index at offset 0 = 365');

const plan = { rows: [], n: 0, total: 0, dueDays: 0, shortfall: 0 };
for (let i = 0; i < 30; i++) plan.rows.push({ key: '', label: '', level: 0, target: 0, actual: -1, left: 0, today: 0 });

const pg = new Uint8Array(C.N);
pg[ti] = 4;      // today at max level
pg[ti - 1] = 4;  // yesterday at max level

let n = C.buildCommitPlan(pg, pkeys, plabels, ti, 7, 4, 1, 10, null, 0, plan);
eq(n, 6, 'plan truncates at the grid end (today sits in the last column)');
eq(plan.rows[0].key, '2026-09-21', 'plan row 0 is today');
eq(plan.rows[0].label, 'Mon Sep 21, 2026', 'plan row 0 label');
eq(plan.rows[1].key, '2026-09-22', 'plan row 1 is tomorrow');
eq(plan.rows[0].today, 1, 'row 0 flagged today');
eq(plan.rows[1].today, 0, 'later rows are not today');
eq(plan.rows[0].target, 10, 'level max -> high commits');
eq(plan.rows[0].actual, -1, 'no sync data -> actual -1');
eq(plan.rows[0].left, 10, 'no sync -> left = target');
eq(plan.rows[1].left, 0, 'empty day -> left 0');
eq(plan.total, 10, 'total = sum of targets');
eq(plan.dueDays, 1, 'dueDays counts days with a target');
eq(plan.shortfall, 0, 'no map -> no shortfall');

const amap = new Map();
amap.set('2026-09-21', 4);  // 4 commits today
amap.set('2026-09-20', 2);  // 2 commits yesterday
eq(C.shortfallOf(pg, pkeys, amap, ti - 1, ti - 1, 4, 1, 10), 8, 'shortfallOf yesterday = target 10 - actual 2');
eq(C.shortfallOf(pg, pkeys, amap, ti - 7, ti - 1, 4, 1, 10), 8, 'shortfallOf over a week only counts unmet days');
eq(C.shortfallOf(pg, pkeys, amap, ti, ti, 4, 1, 10), 6, 'shortfallOf includes today when asked');

C.buildCommitPlan(pg, pkeys, plabels, ti, 7, 4, 1, 10, amap, 0, plan);
eq(plan.rows[0].actual, 4, 'synced actual for today');
eq(plan.rows[0].left, 6, 'left = target - actual');
eq(plan.rows[1].actual, 0, 'synced future day -> actual 0, not -1');
eq(plan.rows[1].left, 0, 'future day without a target has no work');
eq(plan.shortfall, 0, 'carry off -> shortfall 0');

C.buildCommitPlan(pg, pkeys, plabels, ti, 7, 4, 1, 10, amap, 7, plan);
eq(plan.shortfall, 8, 'carry on -> shortfall of the previous 7 days');
eq(plan.rows[0].left, 14, "today's left carries the shortfall");
eq(plan.rows[1].left, 0, 'carry only touches today');

const metmap = new Map([['2026-09-21', 12]]);
C.buildCommitPlan(pg, pkeys, plabels, ti, 7, 4, 1, 10, metmap, 0, plan);
eq(plan.rows[0].left, 0, 'actual above target -> left 0');
eq(plan.rows[0].target, 10, 'target stays the planned number when over-achieved');
C.buildCommitPlan(pg, pkeys, plabels, ti, 7, 4, 1, 10, metmap, 7, plan);
eq(plan.shortfall, 10, 'a date missing from the map counts as 0 commits');

C.buildGridDates(todayMs, 4, pkeys, plabels, pmonths);
const ti4 = C.todayIndex(pkeys, todayMs);
eq(ti4, 337, 'plan: offset +4 today index = 337');
eq(C.buildCommitPlan(pg, pkeys, plabels, ti4, 30, 4, 1, 10, null, 0, plan), 30, 'plan caps at the requested days');

C.buildGridDates(todayMs, -52, pkeys, plabels, pmonths);
eq(C.todayIndex(pkeys, todayMs), -1, 'offset -52 puts today outside the grid');
eq(C.buildCommitPlan(pg, pkeys, plabels, -1, 7, 4, 1, 10, null, 0, plan), 0, 'off-grid plan has no rows');
eq(plan.n, 0, 'off-grid plan leaves n = 0');
eq(plan.total, 0, 'off-grid plan leaves total = 0');
eq(plan.shortfall, 0, 'off-grid plan leaves shortfall = 0');

// level 0 today -> nothing to do, but the row still exists
C.buildGridDates(todayMs, 0, pkeys, plabels, pmonths);
const pg0 = new Uint8Array(C.N);
C.buildCommitPlan(pg0, pkeys, plabels, ti, 7, 4, 1, 10, null, 0, plan);
eq(plan.rows[0].target, 0, 'empty today -> target 0');
eq(plan.rows[0].left, 0, 'empty today -> left 0');
eq(plan.dueDays, 0, 'empty grid -> no due days');

// ---- storage round trip
function randGrid(seed) {
	const g = new Uint8Array(C.N);
	let s = seed;
	for (let i = 0; i < C.N; i++) {
		s = (s * 1103515245 + 12345) & 0x7fffffff;
		g[i] = s % 7; // 0..6
	}
	return g;
}
const g1 = randGrid(42);
const ser = C.serializeGrid(3, g1);
ok(ser.startsWith('GTM1|3|'), 'serialize prefix');
ok(ser.length < 600, 'serialize compact (' + ser.length + ' chars)');
const back = C.parseGrid(ser);
eq(back.off, 3, 'round-trip offset');
ok(back.grid.every((v, i) => v === g1[i]), 'round-trip grid equal');

const back0 = C.parseGrid(C.serializeGrid(0, g1));
eq(back0.off, 0, 'offset 0 round-trip');
let threw = false;
try { C.parseGrid('GTM1|3|Zm9v'); } catch { threw = true; }
ok(threw, 'rejects bad base64 payload');
threw = false;
try { C.parseGrid('hello world'); } catch { threw = true; }
ok(threw, 'rejects garbage');

// plain numbers
const toks = [];
for (let i = 0; i < C.N; i++) toks.push(i % 5);
const plain = toks.join(', ');
const bp = C.parseGrid(plain);
ok(bp.grid.every((v, i) => v === i % 5), 'plain numbers parse');
eq(bp.off, 0, 'plain numbers -> offset 0');

// JSON
const j = JSON.stringify({ v: 1, off: -2, data: C.serializeGrid(0, g1).split('|')[2] });
const bj = C.parseGrid(j);
eq(bj.off, -2, 'json offset');
ok(bj.grid.every((v, i) => v === g1[i]), 'json grid equal');

// ---- fonts
function fontOk(table, name, rows, bits) {
	let bad = 0;
	for (const ch in table) {
		const g = table[ch];
		if (g.length !== rows) bad++;
		for (let r = 0; r < g.length; r++) if (g[r] < 0 || g[r] >= 1 << bits) bad++;
	}
	return bad;
}
eq(fontOk(C.FONT57, '5x7', 7, 5), 0, 'FONT57 well-formed (36+ glyphs x 7 rows x 5 bits)');
eq(fontOk(C.FONT35, '3x5', 5, 3), 0, 'FONT35 well-formed');
ok('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('').every(c => C.FONT57[c]), 'FONT57 has A-Z 0-9');
ok('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('').every(c => C.FONT35[c]), 'FONT35 has A-Z 0-9');
eq(C.textWidth57('HI'), 11, '5x7 width of "HI" = 11');
eq(C.textWidth57('HELLO WORLD'), 65, '5x7 too wide for 53 -> needs 3x5');
eq(C.textWidth35('HELLO WORLD'), 43, '3x5 width of "HELLO WORLD" = 43');

// auto font fit: 5x7 up to 9 chars (53 cols), 3x5 up to 13 chars (51 cols)
eq(C.pickPixelFont('HI'), '57', 'auto font: short text -> 5x7');
eq(C.pickPixelFont('ABCDEFGHI'), '57', 'auto font: 9 chars = 53 cols -> 5x7');
eq(C.pickPixelFont('ABCDEFGHIJ'), '35', 'auto font: 10 chars = 59 cols -> 3x5');
eq(C.pickPixelFont('HELLO WORLD'), '35', 'auto font: 11 chars -> 3x5');
eq(C.pickPixelFont('ABCDEFGHIJKLM'), '35', 'auto font: 13 chars = 51 cols -> 3x5');
eq(C.pickPixelFont('ABCDEFGHIJKLMN'), null, 'auto font: 14 chars = 55 cols -> null');
eq(C.pickPixelFont('   '), null, 'auto font: blank -> null');
eq(C.pickPixelFont(' hi '), '57', 'auto font: trims before measuring');

// pixel render: "HI" into empty grid at level 4
const gp = new Uint8Array(C.N);
const place = C.renderTextPixel(gp, 'HI', '57', 4);
eq(place.w, 11, 'pixel place width');
eq(place.x0, 21, 'pixel place x0 centered (53-11)/2');
const hiCells = [];
for (let i = 0; i < C.N; i++) if (gp[i]) hiCells.push(i);
eq(hiCells.length, 28, 'pixel "HI" cell count (H=17, I=11)');
// every painted cell is exactly level 4
ok(hiCells.every(i => gp[i] === 4), 'pixel cells all at level');
// 'H' left stem: first painted column fully filled rows 0..6
const firstCol = Math.min.apply(null, hiCells) / C.H | 0;
ok([0,1,2,3,4,5,6].every(r => gp[firstCol * C.H + r] === 4), 'H has solid left stem');
// 3x5 render centered with 1 row padding
const gp2 = new Uint8Array(C.N);
C.renderTextPixel(gp2, 'AB', '35', 3);
let top = 7;
for (let i = 0; i < C.N; i++) if (gp2[i] && i % C.H < top) top = i % C.H;
eq(top, 1, '3x5 text starts at row 1 (padding)');

// renderTextPixel is clip-safe
const gp3 = new Uint8Array(C.N);
C.renderTextPixel(gp3, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', '57', 2);
ok(gp3.some(v => v === 2), 'long text clips without throwing');

console.log(failures ? '\n' + failures + ' FAILURES' : '\nall tests passed');
process.exit(failures ? 1 : 0);
