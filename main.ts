const fs = require('node:fs');
const path = require('node:path');

const DIRS = [-1, 1, 0, 0]; // replaced per board by ordered offsets [U,D,L,R]
const LETTERS = ['u', 'd', 'l', 'r'];
const PUSH_LETTERS = ['U', 'D', 'L', 'R'];

function parseLevel(text) {
  const rows = text.replace(/\r/g, '').split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const size = w * h;
  const wall = new Uint8Array(size).fill(1);
  const goals = [], boxes = [];
  let player = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < rows[y].length; x++) {
    const c = rows[y][x], i = y * w + x;
    if (c === '#') continue;
    wall[i] = 0;
    if (c === '.' || c === '*' || c === '+') goals.push(i);
    if (c === '$' || c === '*') boxes.push(i);
    if (c === '@' || c === '+') player = i;
  }
  for (let x = 0; x < w; x++) { wall[x] = 1; wall[(h - 1) * w + x] = 1; }
  for (let y = 0; y < h; y++) { wall[y * w] = 1; wall[y * w + w - 1] = 1; }
  boxes.sort((a, b) => a - b); goals.sort((a, b) => a - b);
  return { w, h, size, wall, goals, boxes, player, offsets: [-w, w, -1, 1] };
}

function makeLive(wall, goals, offsets, size) {
  const live = new Uint8Array(size), q = [];
  for (const g of goals) if (!wall[g] && !live[g]) { live[g] = 1; q.push(g); }
  for (let head = 0; head < q.length; head++) {
    const x = q[head];
    for (const d of offsets) {
      const p = x - d, stand = p - d;
      if (p >= 0 && p < size && stand >= 0 && stand < size && !wall[p] && !wall[stand] && !live[p]) {
        live[p] = 1; q.push(p);
      }
    }
  }
  return live;
}

function decompose(board) {
  const { wall, goals, boxes, player, w, h, size, offsets } = board;
  const live = makeLive(wall, goals, offsets, size);
  const cut = new Uint8Array(size), row = Math.floor(player / w);
  for (let x = 0; x < w; x++) { const i = row * w + x; if (!wall[i] && !live[i]) cut[i] = 1; }
  if (boxes.some((b) => cut[b]) || goals.some((g) => cut[g])) return null;
  const seen = new Uint8Array(size), rooms = [];
  for (let s = 0; s < size; s++) {
    if (wall[s] || cut[s] || seen[s]) continue;
    const q = [s], cells = []; seen[s] = 1;
    for (let head = 0; head < q.length; head++) {
      const x = q[head]; cells.push(x);
      for (const d of offsets) { const n = x + d; if (n >= 0 && n < size && !wall[n] && !cut[n] && !seen[n]) { seen[n] = 1; q.push(n); } }
    }
    const set = new Set(cells), rb = boxes.filter((b) => set.has(b)), rg = goals.filter((g) => set.has(g));
    if (rb.length !== rg.length) return null;
    if (rb.length) rooms.push({ boxes: rb, goals: rg, min: s });
  }
  rooms.sort((a, b) => a.min - b.min);
  if (boxes.length !== goals.length || rooms.reduce((n, r) => n + r.boxes.length, 0) !== boxes.length) return null;
  return rooms;
}

function createHeap() {
  const a = [];
  function less(x, y) { return x.f !== y.f ? x.f < y.f : x.g !== y.g ? x.g > y.g : x.seq < y.seq; }
  return {
    get length() { return a.length; },
    push(v) { let i = a.length; a.push(v); while (i) { const p = (i - 1) >> 1; if (!less(v, a[p])) break; a[i] = a[p]; i = p; } a[i] = v; },
    pop() { const top = a[0], v = a.pop(); if (a.length) { let i = 0; while (true) { let c = i * 2 + 1; if (c >= a.length) break; if (c + 1 < a.length && less(a[c + 1], a[c])) c++; if (!less(a[c], v)) break; a[i] = a[c]; i = c; } a[i] = v; } return top; }
  };
}

function solveRoom(board, startBoxes, goals, player, extraWall, budget) {
  const { size, w, offsets } = board;
  const wall = board.wall.slice();
  if (extraWall) for (const p of extraWall) wall[p] = 1;
  const goalSet = new Set(goals);
  const live = makeLive(wall, goals, offsets, size);
  const distances = goals.map((g) => {
    const dist = new Int32Array(size).fill(-1), q = [g]; dist[g] = 0;
    for (let head = 0; head < q.length; head++) {
      const x = q[head];
      for (const d of offsets) { const p = x - d, stand = p - d; if (p >= 0 && p < size && stand >= 0 && stand < size && !wall[p] && !wall[stand] && dist[p] < 0) { dist[p] = dist[x] + 1; q.push(p); } }
    }
    return dist;
  });
  const n = startBoxes.length, stamp = new Int32Array(size), seenStamp = new Int32Array(size);
  let stampId = 0;
  function region(boxes, from, mark) {
    const blocked = new Uint8Array(size);
    for (const b of boxes) blocked[b] = 1;
    mark = mark || ++stampId;
    const q = [from]; seenStamp[from] = mark; let min = from;
    for (let head = 0; head < q.length; head++) { const x = q[head]; if (x < min) min = x;
      for (const d of offsets) { const z = x + d; if (z >= 0 && z < size && !wall[z] && !blocked[z] && seenStamp[z] !== mark) { seenStamp[z] = mark; q.push(z); } }
    }
    return min;
  }
  function heuristic(boxes) {
    if (n <= 8) {
      let dp = new Float64Array(1 << n); dp.fill(Infinity); dp[0] = 0;
      for (let i = 0; i < n; i++) { const next = new Float64Array(1 << n); next.fill(Infinity);
        for (let mask = 0; mask < (1 << n); mask++) if (Number.isFinite(dp[mask]) && popcount(mask) === i) for (let j = 0; j < n; j++) if (!(mask & (1 << j))) { const c = distances[j][boxes[i]]; if (c >= 0) next[mask | (1 << j)] = Math.min(next[mask | (1 << j)], dp[mask] + c); }
        dp = next;
      }
      return dp[(1 << n) - 1];
    }
    let sum = 0; for (const b of boxes) { let best = Infinity; for (const d of distances) if (d[b] >= 0) best = Math.min(best, d[b]); if (!Number.isFinite(best)) return Infinity; sum += best; } return sum;
  }
  function key(boxes, rep) { if ((n + 1) * Math.log2(size) < 53) { let k = rep; for (const b of boxes) k = k * size + b; return k; } return boxes.join(',') + '|' + rep; }
  function frozen(boxes, t) {
    const occupied = new Uint8Array(size); for (const b of boxes) occupied[b] = 1;
    const x = t % w, y = Math.floor(t / w);
    for (const [dx, dy] of [[0,0],[-1,0],[0,-1],[-1,-1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx + 1 >= w || yy + 1 >= board.h) continue;
      let full = true, bad = false;
      for (let oy = 0; oy < 2; oy++) for (let ox = 0; ox < 2; ox++) { const p = (yy + oy) * w + xx + ox; if (!wall[p] && !occupied[p]) full = false; if (occupied[p] && !goalSet.has(p)) bad = true; }
      if (full && bad) return true;
    } return false;
  }
  let boxes = startBoxes.slice().sort((a, b) => a - b);
  if (boxes.every((b) => goalSet.has(b))) return '';
  const rep = region(boxes, player), h0 = heuristic(boxes); if (!Number.isFinite(h0)) return null;
  const nodes = [{ boxes, parent: -1, from: -1, dir: -1, g: 0 }], heap = createHeap(), best = new Map();
  let seq = 0; const k0 = key(boxes, rep); best.set(k0, 0); heap.push({ idx: 0, g: 0, h: h0, f: h0, rep, key: k0, seq: seq++ });
  let expansions = 0, goalIdx = -1;
  while (heap.length && expansions < budget) {
    const entry = heap.pop(); if (best.get(entry.key) !== entry.g) continue;
    expansions++;
    const state = nodes[entry.idx], bs = state.boxes;
    if (bs.every((b) => goalSet.has(b))) { goalIdx = entry.idx; break; }
    const mark = ++stampId, blocked = new Uint8Array(size); for (const b of bs) blocked[b] = 1;
    const q = [entry.rep]; stamp[entry.rep] = mark;
    for (let head = 0; head < q.length; head++) { const x = q[head]; for (const d of offsets) { const z = x + d; if (z >= 0 && z < size && !wall[z] && !blocked[z] && stamp[z] !== mark) { stamp[z] = mark; q.push(z); } } }
    for (let bi = 0; bi < bs.length; bi++) for (let di = 0; di < 4; di++) {
      const b = bs[bi], d = offsets[di], stand = b - d, t = b + d;
      if (stand < 0 || stand >= size || stamp[stand] !== mark || t < 0 || t >= size || wall[t] || blocked[t] || !live[t]) continue;
      const child = bs.slice(); child[bi] = t; child.sort((a, b) => a - b);
      if (frozen(child, t)) continue;
      const ng = entry.g + 1, nh = heuristic(child); if (!Number.isFinite(nh)) continue;
      const nr = region(child, b), nk = key(child, nr); if (best.has(nk) && best.get(nk) <= ng) continue;
      best.set(nk, ng); const idx = nodes.length; nodes.push({ boxes: child, parent: entry.idx, from: b, dir: di, g: ng });
      heap.push({ idx, g: ng, h: nh, f: ng + nh, rep: nr, key: nk, seq: seq++ });
    }
  }
  if (goalIdx < 0) return null;
  const pushes = []; for (let i = goalIdx; nodes[i].parent >= 0; i = nodes[i].parent) pushes.push({ from: nodes[i].from, dir: nodes[i].dir }); pushes.reverse();
  let currentPlayer = player, simBoxes = startBoxes.slice(), result = '';
  for (const p of pushes) {
    const stand = p.from - offsets[p.dir], blocked = new Uint8Array(size); for (const b of simBoxes) blocked[b] = 1;
    const prev = new Int32Array(size).fill(-2), prevDir = new Int8Array(size), q = [currentPlayer]; prev[currentPlayer] = -1;
    for (let head = 0; head < q.length && prev[stand] === -2; head++) { const x = q[head]; for (let di = 0; di < 4; di++) { const z = x + offsets[di]; if (z >= 0 && z < size && !wall[z] && !blocked[z] && prev[z] === -2) { prev[z] = x; prevDir[z] = di; q.push(z); } } }
    if (prev[stand] === -2) return null;
    let walk = '', cur = stand; while (cur !== currentPlayer) { const di = prevDir[cur]; walk = LETTERS[di] + walk; cur = prev[cur]; }
    result += walk + PUSH_LETTERS[p.dir]; currentPlayer = p.from;
    const bi = simBoxes.indexOf(p.from); if (bi < 0) return null; simBoxes[bi] = p.from + offsets[p.dir];
  }
  return result;
}

function popcount(x) { let n = 0; while (x) { x &= x - 1; n++; } return n; }

function replay(board, moves) {
  let player = board.player; const boxes = new Set(board.boxes), goals = new Set(board.goals);
  const dirMap = { u: -board.w, d: board.w, l: -1, r: 1 };
  for (const ch of moves) { const d = dirMap[ch.toLowerCase()], next = player + d; if (next < 0 || next >= board.size || board.wall[next]) return false;
    if (boxes.has(next)) { const beyond = next + d; if (beyond < 0 || beyond >= board.size || board.wall[beyond] || boxes.has(beyond)) return false; boxes.delete(next); boxes.add(beyond); }
    player = next;
  }
  return boxes.size === goals.size && [...boxes].every((b) => goals.has(b));
}

function solveLevel(board) {
  if (board.boxes.length === board.goals.length && board.boxes.every((b) => board.goals.includes(b))) return '';
  const rooms = decompose(board);
  let answer = null;
  if (rooms) {
    const initialBoxes = board.boxes.slice(), goalSet = new Set(board.goals);
    let player = board.player, moves = '', failed = false;
    for (let ri = 0; ri < rooms.length; ri++) {
      const room = rooms[ri], own = new Set(room.boxes), extra = [];
      for (let oi = 0; oi < rooms.length; oi++) if (oi !== ri) {
        const other = rooms[oi];
        if (oi < ri) extra.push(...other.goals);
        else extra.push(...other.boxes);
      }
      const walls = extra;
      const part = solveRoom(board, room.boxes, room.goals, player, walls, 4000000);
      if (part === null) { failed = true; break; }
      moves += part;
      for (const ch of part) player += ({ u: -board.w, U: -board.w, d: board.w, D: board.w, l: -1, L: -1, r: 1, R: 1 })[ch];
    }
    if (!failed) answer = moves;
  }
  if (answer === null) answer = solveRoom(board, board.boxes, board.goals, board.player, [], 8000000);
  if (answer === null || !replay(board, answer)) return '';
  return answer;
}

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of fs.readdirSync(inputDir).sort()) {
  const text = fs.readFileSync(path.join(inputDir, id, 'level.txt'), 'utf8');
  const board = parseLevel(text);
  const solution = board.player < 0 ? '' : solveLevel(board);
  fs.mkdirSync(path.join(outputDir, id), { recursive: true });
  fs.writeFileSync(path.join(outputDir, id, 'solution.txt'), solution + '\n');
}
