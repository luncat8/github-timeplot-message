// experiments/header-shot.js - renders the demo year and saves a README header
// screenshot of the plot (2x). Serves the repo over localhost (ES modules do not
// load from file://), clicks the demo button, crops #plotWrap.
//
//   node experiments/header-shot.js [out.png]
//
// Browser resolution: plain `playwright` by default. With
// SHOT_MODULES=/path/to/node_modules it uses playwright-core plus
// @sparticuz/chromium from that dir instead (binary bundled in the npm
// package - useful where the playwright browser CDN is unreachable):
//   SHOT_MODULES=~/shots/node_modules node experiments/header-shot.js

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.resolve(process.argv[2] || path.join(root, 'header.png'));
// bare specifiers when the packages are reachable normally; otherwise a file
// URL base pointing at a node_modules dir (its package entry files)
const MOD = process.env.SHOT_MODULES ? 'file://' + path.resolve(process.env.SHOT_MODULES) + '/' : null;
const imp = name => import(MOD ? MOD + name + '/index.js' : name);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

const server = http.createServer(async (req, res) => {
	let p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
	if (p.endsWith(path.sep)) p += 'index.html';
	try {
		const data = await readFile(p);
		res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
		res.end(data);
	} catch {
		res.writeHead(404);
		res.end('not found');
	}
});
await new Promise(r => server.listen(0, '127.0.0.1', r));

let pw;
let slc = null;
if (MOD) {
	slc = (await import(MOD + '@sparticuz/chromium/build/index.js')).default;
	pw = await imp('playwright-core');
	if (!pw.chromium) pw = pw.default; // CJS interop
} else {
	pw = await import('playwright');
}
const launchOpts = slc
	? { executablePath: await slc.executablePath(), args: slc.args }
	: {};
const browser = await pw.chromium.launch({ headless: true, ...launchOpts });

const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 2 });
await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'networkidle' });
await page.click('#btnDemo');
await page.waitForTimeout(400); // let the render rAF flush
await page.locator('#plotWrap').screenshot({ path: out });
await browser.close();
server.close();
console.log('saved ' + out);
