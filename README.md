## message in github commit history plot

Paint a 53x7 grid styled like the GitHub contributions graph, map its cells to real
calendar dates, and get per-day commit-count suggestions so your profile renders the
message/picture you painted.

- no build, no backend — open `index.html` (or serve the folder)
- draw / erase / rect tools, fill, clear, undo, amount slider (relative to max)
- text: pixel 5x7, pixel 3x5, or smooth antialiased (intermediate levels)
- week offset slider (-52..+52) as a wide track directly under the grid with
  a today marker; drag, click to jump, scroll over the plot/track to scrub,
  arrow keys when focused
- month labels, today outline, future dimming
- hover tooltip: date, level, ~commits, your actual commits
- auto-save (localStorage) + import/export compact `GTM1|offset|base64` string
- PNG export of the rendered grid (`timeplot-<startISO>-<endISO>.png`, 2x)
- GitHub sync (optional PAT): contribution overlay dots + "today you need ~N commits"
  with yesterday planned-vs-actual
- keyboard: 1-9/0 amount, D/E/R tools, F fill, C clear, Ctrl+Z undo

### run

```
python3 -m http.server 8000   # then open http://localhost:8000
```

### files

- `index.html` — page + styles
- `core.js` — pure logic (date math, palette, storage codec, fonts)
- `app.js` — DOM, canvas, events (plot canvas + offset slider canvas + PNG export)
- `experiments/core-test.js`, `experiments/dom-smoke.js` — `node` tests

### this repo
https://github.com/luncat8/github-timeplot-message.git
