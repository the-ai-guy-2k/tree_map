'use strict';

window.__consoleErrors = [];
window.addEventListener('error', (e) => {
  if (e.message) window.__consoleErrors.push(e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason;
  window.__consoleErrors.push(String(reason && reason.message ? reason.message : reason));
});

const BRANCHES = {
  nebula:   { label: 'Nebula',         color: '#9aa8bc' },
  its:      { label: 'TAIG ITS',       color: '#3dbe86' },
  taig2k:   { label: 'TAIG 2K',        color: '#2f9d6a' },
  services: { label: 'TAIG Services',  color: '#3aa8a0' },
  duval:    { label: 'Job / Duval',    color: '#4aa3c7' },
  funding:  { label: 'Funding',        color: '#d4894a' },
  clients:  { label: 'Clients',        color: '#6a93d6' },
  c3:       { label: 'C³ Reports',     color: '#d16b6b' },
  ideas:    { label: 'Ideas',          color: '#d4a24a' },
  social:   { label: 'Social',         color: '#c6b15a' },
  promo:    { label: 'Album / Promo',  color: '#a78bfa' },
  future:   { label: 'Future Clients', color: '#8b8fe8' },
  tan:      { label: 'TAIG TAN',       color: '#8fbf55' },
  cott:     { label: 'COTT',           color: '#6f9a45' },
};
const HUBS = new Set(['its', 'promo', 'tan', 'cott']);
const STATUS = {
  active:  { label: 'Active',  color: '#3dbe86' },
  waiting: { label: 'Waiting', color: '#d4a24a' },
  done:    { label: 'Done',    color: '#8b97a8' },
  blocked: { label: 'Blocked', color: '#d16b6b' },
  none:    { label: 'None',    color: 'transparent' },
};
const FONT = {
  hub: '700 18px Inter, system-ui, sans-serif',
  bubble: '600 14px Inter, system-ui, sans-serif',
  sub: '400 12px Inter, system-ui, sans-serif',
};
const GAP_X = 24;
const V_GAP = 48;
const DUR = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 260;
const NS = 'http://www.w3.org/2000/svg';

const svg = document.getElementById('map');
const panel = document.getElementById('panel');
const search = document.getElementById('search');
const labelInput = document.getElementById('label');
const subInput = document.getElementById('sub');
const noteInput = document.getElementById('note');
const branchSel = document.getElementById('branch');
const branchDot = document.getElementById('branchDot');
const crumbEl = document.getElementById('crumb');
const touchedEl = document.getElementById('touched');
const deleteRow = document.getElementById('deleteRow');
const addRow = document.getElementById('addRow');
const childInput = document.getElementById('childLabel');
const confirmEl = document.getElementById('confirm');
const confirmText = document.getElementById('confirmText');

const cameraG = document.createElementNS(NS, 'g');
const edgesG = document.createElementNS(NS, 'g');
const nodesG = document.createElementNS(NS, 'g');
cameraG.append(edgesG, nodesG);
svg.appendChild(cameraG);

const measureCanvas = document.createElement('canvas');
const measureCtx = measureCanvas.getContext('2d');
const measureCache = new Map();

const state = {
  bubbles: [],
  focus: 'all',
  folded: new Set(),
  selected: null,
  query: '',
};
let byId = new Map();
let kids = new Map();
let current = [];
let leaving = [];
const view = new Map();
let booted = false;
let fillLock = false;
let raf = 0;
let dirtyKey = '';
let lastKey = '';
let layoutT0 = 0;
let camT0 = 0;
let cam = { tx: 0, ty: 0, k: 1 };
let camS = { tx: 0, ty: 0, k: 1 };
let camD = { tx: 0, ty: 0, k: 1 };
let edgeEls = [];
let suppressClick = false;
const pointers = new Map();
let pinch = null;
let pending = new Map();
let patchTimer = 0;

function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function ease(t) { return 1 - Math.pow(1 - t, 3); }
function snap8(n) { return Math.ceil(n / 8) * 8; }

function measure(text, font) {
  const key = font + '\n' + text;
  const hit = measureCache.get(key);
  if (hit != null) return hit;
  measureCtx.font = font;
  const w = measureCtx.measureText(text).width;
  measureCache.set(key, w);
  return w;
}

function wrap(text, font, maxW) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let cur = '';
  const push = (s) => { if (s) lines.push(s); };
  for (const word of words) {
    if (measure(word, font) > maxW) {
      push(cur);
      cur = '';
      let chunk = '';
      for (const ch of word) {
        const trial = chunk + ch;
        if (chunk && measure(trial, font) > maxW) {
          push(chunk);
          chunk = ch;
        } else chunk = trial;
      }
      cur = chunk;
      continue;
    }
    const trial = cur ? cur + ' ' + word : word;
    if (measure(trial, font) <= maxW) cur = trial;
    else { push(cur); cur = word; }
  }
  push(cur);
  if (lines.length > 3) {
    let last = lines[2];
    while (last.length > 1 && measure(last + '…', font) > maxW) last = last.slice(0, -1);
    lines.length = 3;
    lines[2] = last.replace(/…$/, '') + '…';
  }
  return lines;
}

function norm(b) {
  const status = !b.status || b.status === 'none' ? 'none' : b.status;
  return {
    id: b.id,
    label: b.label || '',
    sub: b.sub || '',
    branch: BRANCHES[b.branch] ? b.branch : 'its',
    parentId: b.parentId ?? b.parent_id ?? null,
    touched: b.touched || '',
    note: b.note || '',
    status,
    sort: b.sort ?? 0,
  };
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    const err = new Error((data && data.error) || 'Request failed');
    err.status = res.status;
    throw err;
  }
  return data;
}

function reindex() {
  byId = new Map();
  kids = new Map();
  for (const b of state.bubbles) {
    byId.set(b.id, b);
    const key = b.parentId ?? null;
    if (!kids.has(key)) kids.set(key, []);
    kids.get(key).push(b);
  }
  for (const list of kids.values()) {
    list.sort((a, b) => (a.sort - b.sort) || a.label.localeCompare(b.label));
  }
}
function children(id) { return kids.get(id) || []; }

function isUnder(id, anc) {
  let cur = byId.get(id);
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    if (cur.id === anc) return true;
    guard.add(cur.id);
    cur = byId.get(cur.parentId);
  }
  return false;
}
function inFocus(b) {
  if (state.focus === 'all') return true;
  return isUnder(b.id, state.focus) || isUnder(state.focus, b.id);
}
function isVisible(b) {
  if (!inFocus(b)) return false;
  let p = byId.get(b.parentId);
  const guard = new Set();
  while (p && !guard.has(p.id)) {
    if (state.folded.has(p.id)) return false;
    guard.add(p.id);
    p = byId.get(p.parentId);
  }
  return true;
}

function rankOf(b, q) {
  const label = b.label.toLowerCase();
  const sub = (b.sub || '').toLowerCase();
  const note = (b.note || '').toLowerCase();
  if (!label.includes(q) && !sub.includes(q) && !note.includes(q)) return null;
  if (label === q) return 0;
  if (label.startsWith(q)) return 1 + label.length / 10000;
  if (label.includes(q)) return 2 + label.length / 10000;
  return 3;
}
function targetOpacity(b) {
  const q = state.query.trim().toLowerCase();
  if (!q) return 1;
  if (state.selected === b.id) return 1;
  return rankOf(b, q) == null ? 0.2 : 1;
}

function metrics(b) {
  const isHub = HUBS.has(b.id);
  const isBase = b.id === 'nebula';
  const labelFont = isHub || isBase ? FONT.hub : FONT.bubble;
  const labelSize = isHub || isBase ? 18 : 14;
  const labelWeight = isHub || isBase ? 700 : 600;
  const maxInner = 224;
  const labelLines = wrap(b.label, labelFont, maxInner);
  if (!labelLines.length) labelLines.push(b.label || ' ');
  const subLines = wrap(b.sub, FONT.sub, maxInner);
  const showToday = b.touched === todayStr();
  const showStatus = !!(STATUS[b.status] && b.status !== 'none');
  const showNote = !!(b.note || '').trim();
  const todayW = showToday ? snap8(measure('TODAY', FONT.sub) + 16) : 0;
  const noteW = showNote ? measure('Note', FONT.sub) : 0;
  const tagItems = [];
  if (showToday) tagItems.push(todayW);
  if (showStatus) tagItems.push(8);
  if (showNote) tagItems.push(noteW);
  const tagsW = tagItems.reduce((s, w) => s + w, 0) + Math.max(0, tagItems.length - 1) * 8;
  let inner = 48;
  for (const line of labelLines) inner = Math.max(inner, measure(line, labelFont));
  for (const line of subLines) inner = Math.max(inner, measure(line, FONT.sub));
  inner = Math.max(inner, tagsW) + 4;
  const padX = isBase ? 56 : 16;
  let boxW = snap8(Math.max(96, inner + padX * 2));
  const labelBlock = labelLines.length * 24;
  const subBlock = subLines.length ? 8 + subLines.length * 16 : 0;
  const tagBlock = tagItems.length ? 8 + 16 : 0;
  let boxH = snap8(labelBlock + subBlock + tagBlock + 16);
  if (isBase) boxH = snap8(boxH + 24);
  const kidCount = children(b.id).filter(inFocus).length;
  let badgeW = 0;
  if (kidCount) {
    const folded = state.folded.has(b.id);
    const badgeText = (folded ? '+ ' : '− ') + kidCount;
    badgeW = snap8(measure(badgeText, FONT.sub) + 16);
  }
  return {
    id: b.id,
    parentId: b.parentId,
    branch: b.branch,
    label: b.label,
    isBase,
    labelLines,
    subLines,
    labelSize,
    labelWeight,
    showToday,
    showStatus,
    showNote,
    status: b.status,
    todayW,
    noteW,
    tagsW,
    hasTags: tagItems.length > 0,
    boxW,
    boxH,
    badgeW,
    kidCount,
    w: Math.max(boxW, badgeW),
    h: boxH,
  };
}

function layoutForest(roots) {
  let x0 = 0;
  const all = [];
  for (const root of roots) {
    measureSubtree(root, 0);
    place(root, 0);
    const nodes = flatten(root);
    let minX = Infinity;
    let maxX = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x - n.w / 2);
      maxX = Math.max(maxX, n.x + n.w / 2);
    }
    const shift = x0 - minX;
    for (const n of nodes) n.x += shift;
    x0 += (maxX - minX) + GAP_X;
    assignY(nodes);
    all.push(...nodes);
  }
  for (const n of all) {
    n.x = Math.round(n.x);
    n.y = Math.round(n.y);
  }
  return all;
}
function measureSubtree(n, depth) {
  n.depth = depth;
  n.kids.forEach((k) => measureSubtree(k, depth + 1));
  if (!n.kids.length) {
    n.subtreeW = n.w;
    n.childSpan = 0;
    return;
  }
  const span = n.kids.reduce((s, k) => s + k.subtreeW, 0) + GAP_X * (n.kids.length - 1);
  n.childSpan = span;
  n.subtreeW = Math.max(n.w, span);
}
function place(n, left) {
  if (!n.kids.length) {
    n.x = left + n.subtreeW / 2;
    return;
  }
  let x = left + (n.subtreeW - n.childSpan) / 2;
  for (const k of n.kids) {
    place(k, x);
    x += k.subtreeW + GAP_X;
  }
  n.x = (n.kids[0].x + n.kids[n.kids.length - 1].x) / 2;
}
function assignY(nodes) {
  const maxD = nodes.reduce((m, n) => Math.max(m, n.depth), 0);
  const levelH = Array(maxD + 1).fill(0);
  nodes.forEach((n) => { levelH[n.depth] = Math.max(levelH[n.depth], n.h); });
  const centerY = [];
  let cursor = 0;
  for (let d = maxD; d >= 0; d--) {
    centerY[d] = cursor + levelH[d] / 2;
    cursor += levelH[d] + V_GAP;
  }
  nodes.forEach((n) => { n.y = centerY[n.depth]; });
}
function flatten(n, out = []) {
  out.push(n);
  n.kids.forEach((k) => flatten(k, out));
  return out;
}

function compute() {
  const visible = state.bubbles.filter(isVisible);
  const nodes = visible.map((b) => {
    const n = metrics(b);
    n.to = targetOpacity(b);
    n.kids = [];
    return n;
  });
  const map = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    n.kids = children(n.id).map((c) => map.get(c.id)).filter(Boolean);
  }
  const roots = nodes.filter((n) => !n.parentId || !map.has(n.parentId));
  if (!roots.length) return [];
  layoutForest(roots);
  return nodes;
}

function viewSize() {
  const r = svg.getBoundingClientRect();
  return { w: r.width || svg.clientWidth || 1, h: r.height || svg.clientHeight || 1 };
}
function treeBounds() {
  if (!current.length) return { minX: 0, minY: 0, maxX: 320, maxY: 240, w: 320, h: 240 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of current) {
    minX = Math.min(minX, n.x - n.w / 2);
    maxX = Math.max(maxX, n.x + n.w / 2);
    minY = Math.min(minY, n.y - n.h / 2 - (n.kidCount ? 40 : 8));
    maxY = Math.max(maxY, n.y + n.h / 2);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}
function kMax() { return 2; }
function rawFitK() {
  const b = treeBounds();
  const { w, h } = viewSize();
  const pad = 32;
  const k = Math.min((w - pad * 2) / Math.max(1, b.w), (h - pad * 2) / Math.max(1, b.h));
  return Number.isFinite(k) && k > 0 ? k : 1;
}
function kMin() { return Math.min(1, Math.max(0.2, rawFitK() * 0.8)); }

function clampAxis(t, min, max, view, k, margin) {
  const extent = (max - min) * k;
  const slack = view - 2 * margin - extent;
  if (slack >= 0) {
    const lo = margin - min * k;
    const hi = view - margin - max * k;
    return clamp(t, Math.min(lo, hi), Math.max(lo, hi));
  }
  const lo = margin - max * k;
  const hi = view - margin - min * k;
  return clamp(t, Math.min(lo, hi), Math.max(lo, hi));
}
function clampCam(tx, ty, k, opts = {}) {
  if (!opts.allowSmall) k = Math.max(kMin(), k);
  k = Math.min(kMax(), Math.max(opts.allowSmall ? 0.08 : kMin(), k));
  const b = treeBounds();
  const { w, h } = viewSize();
  return {
    tx: clampAxis(tx, b.minX, b.maxX, w, k, 24),
    ty: clampAxis(ty, b.minY, b.maxY, h, k, 24),
    k,
  };
}
function cameraForBounds() {
  const b = treeBounds();
  const { w, h } = viewSize();
  let k = Math.min(rawFitK(), 1.35);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return clampCam(w / 2 - cx * k, h / 2 - cy * k, k, { allowSmall: true });
}
function cameraForNode(id) {
  const n = current.find((item) => item.id === id);
  const { w, h } = viewSize();
  if (!n) return cameraForBounds();
  let k = clamp(Math.max(camD.k, 1), 0.2, kMax());
  return clampCam(w / 2 - n.x * k, h / 2 - n.y * k, k, { allowSmall: true });
}
function setCamDest(tx, ty, k, jump, opts) {
  const c = clampCam(tx, ty, k, opts);
  if (jump) {
    cam = { ...c };
    camS = { ...c };
    camD = { ...c };
    camT0 = performance.now() - DUR;
  } else {
    camS = { tx: cam.tx, ty: cam.ty, k: cam.k };
    camD = c;
    camT0 = performance.now();
  }
  kick();
}
function zoomAt(sx, sy, factor) {
  const base = camD;
  const wx = (sx - base.tx) / base.k;
  const wy = (sy - base.ty) / base.k;
  const nk = clamp(base.k * factor, kMin(), kMax());
  setCamDest(sx - wx * nk, sy - wy * nk, nk, false);
}

function startFor(n) {
  const existing = view.get(n.id);
  if (existing) return { x: existing.x, y: existing.y, o: existing.o };
  const parent = n.parentId && view.get(n.parentId);
  if (parent) return { x: parent.x, y: parent.y, o: 0 };
  return { x: n.x, y: n.y, o: 0 };
}

function relayout(opts = {}) {
  const old = current;
  const oldById = new Map(old.map((n) => [n.id, n]));
  const nodes = compute();
  const nextIds = new Set(nodes.map((n) => n.id));
  leaving = leaving.filter((item) => !nextIds.has(item.id));
  const leavingIds = new Set(leaving.map((item) => item.id));
  for (const n of old) {
    if (nextIds.has(n.id) || leavingIds.has(n.id)) continue;
    const v = view.get(n.id) || { x: n.x, y: n.y, o: 1 };
    leaving.push({ ...n, _s: { x: v.x, y: v.y, o: v.o }, t0: performance.now() });
  }
  for (const id of [...view.keys()]) {
    if (!nextIds.has(id) && !leaving.some((item) => item.id === id)) view.delete(id);
  }
  current = nodes;
  if (opts.snap) {
    for (const n of nodes) {
      n._s = { x: n.x, y: n.y, o: n.to };
      view.set(n.id, { ...n._s });
    }
    layoutT0 = performance.now() - DUR;
  } else {
    for (const n of nodes) n._s = startFor(n);
    for (const n of nodes) view.set(n.id, { ...n._s });
    layoutT0 = performance.now();
  }
  let dest = null;
  if (opts.fitId) dest = cameraForNode(opts.fitId);
  else if (opts.fit) dest = cameraForBounds();
  if (dest) {
    if (opts.jump) {
      cam = { ...dest };
      camS = { ...dest };
      camD = { ...dest };
      camT0 = performance.now() - DUR;
    } else {
      camS = { tx: cam.tx, ty: cam.ty, k: cam.k };
      camD = dest;
      camT0 = performance.now();
    }
  }
  build();
  lastKey = contentKey();
  kick();
}

function contentKey() {
  const parts = [];
  for (const n of current) {
    parts.push([
      n.id, n.label, n.labelLines.join('~'), n.subLines.join('~'),
      n.boxW, n.boxH, n.kidCount, state.folded.has(n.id) ? 1 : 0,
      n.showToday ? 1 : 0, n.showStatus ? n.status : '', n.showNote ? 1 : 0, n.branch,
    ].join(':'));
  }
  parts.push('#');
  for (const n of leaving) parts.push('L' + n.id);
  return parts.join('|');
}

function textEl(parent, x, y, str, size, weight, fill) {
  const t = document.createElementNS(NS, 'text');
  t.setAttribute('x', x);
  t.setAttribute('y', y);
  t.setAttribute('text-anchor', 'middle');
  t.setAttribute('dominant-baseline', 'central');
  t.setAttribute('fill', fill);
  t.setAttribute('font-family', 'Inter, system-ui, sans-serif');
  t.setAttribute('font-size', String(size));
  t.setAttribute('font-weight', String(weight));
  t.setAttribute('pointer-events', 'none');
  t.textContent = str;
  parent.appendChild(t);
}
function chip(parent, x, y, w, h, str, fill, color) {
  const r = document.createElementNS(NS, 'rect');
  r.setAttribute('x', x);
  r.setAttribute('y', y - h / 2);
  r.setAttribute('width', w);
  r.setAttribute('height', h);
  r.setAttribute('rx', 999);
  r.setAttribute('fill', fill);
  r.setAttribute('pointer-events', 'none');
  parent.appendChild(r);
  textEl(parent, x + w / 2, y, str, 12, 400, color);
}
function drawTags(g, n, cy) {
  let x = -n.tagsW / 2;
  if (n.showToday) {
    chip(g, x, cy, n.todayW, 16, 'TODAY', '#e2a15a', '#1a140c');
    x += n.todayW + 8;
  }
  if (n.showStatus) {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', x + 4);
    c.setAttribute('cy', cy);
    c.setAttribute('r', 4);
    c.setAttribute('fill', (STATUS[n.status] || STATUS.none).color);
    c.setAttribute('pointer-events', 'none');
    g.appendChild(c);
    x += 16;
  }
  if (n.showNote) textEl(g, x + n.noteW / 2, cy, 'Note', 12, 400, '#8b97a8');
}
function drawNode(n) {
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'node' + (state.selected === n.id ? ' is-selected' : ''));
  g.dataset.id = n.id;
  g.setAttribute('role', 'button');
  g.setAttribute('aria-label', n.label);
  const color = (BRANCHES[n.branch] || BRANCHES.its).color;
  let shape;
  if (n.isBase) {
    shape = document.createElementNS(NS, 'ellipse');
    shape.setAttribute('cx', '0');
    shape.setAttribute('cy', '0');
    shape.setAttribute('rx', n.boxW / 2);
    shape.setAttribute('ry', n.boxH / 2);
    shape.setAttribute('class', 'node-box is-base');
  } else {
    shape = document.createElementNS(NS, 'rect');
    shape.setAttribute('x', -n.boxW / 2);
    shape.setAttribute('y', -n.boxH / 2);
    shape.setAttribute('width', n.boxW);
    shape.setAttribute('height', n.boxH);
    shape.setAttribute('rx', '16');
    shape.setAttribute('class', 'node-box');
  }
  shape.setAttribute('stroke', color);
  g.appendChild(shape);

  const labelBlock = n.labelLines.length * 24;
  const subBlock = n.subLines.length ? 8 + n.subLines.length * 16 : 0;
  const tagBlock = n.hasTags ? 8 + 16 : 0;
  let cursor = -(labelBlock + subBlock + tagBlock) / 2;
  n.labelLines.forEach((line) => {
    textEl(g, 0, cursor + 12, line, n.labelSize, n.labelWeight, '#e8edf4');
    cursor += 24;
  });
  if (n.subLines.length) {
    cursor += 8;
    n.subLines.forEach((line) => {
      textEl(g, 0, cursor + 8, line, 12, 400, '#8b97a8');
      cursor += 16;
    });
  }
  if (n.hasTags) {
    cursor += 8;
    drawTags(g, n, cursor + 8);
  }
  if (n.kidCount) {
    const folded = state.folded.has(n.id);
    const badge = document.createElementNS(NS, 'g');
    badge.setAttribute('class', 'fold');
    badge.dataset.for = n.id;
    const bw = n.badgeW;
    const bh = 24;
    const by = -n.boxH / 2 - 8 - bh / 2;
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', -bw / 2);
    r.setAttribute('y', by - bh / 2);
    r.setAttribute('width', bw);
    r.setAttribute('height', bh);
    r.setAttribute('rx', '999');
    r.setAttribute('class', 'fold-box');
    r.setAttribute('fill', '#171c24');
    r.setAttribute('stroke', '#2a3340');
    badge.appendChild(r);
    textEl(badge, 0, by, (folded ? '+ ' : '− ') + n.kidCount, 12, 400, '#e8edf4');
    g.appendChild(badge);
  }
  const v = view.get(n.id);
  if (v) {
    g.setAttribute('transform', `translate(${v.x} ${v.y})`);
    g.setAttribute('opacity', String(v.o));
  }
  return g;
}
function curve(fromId, toId) {
  const a = view.get(fromId);
  const b = view.get(toId);
  const ga = geomOf(fromId);
  const gb = geomOf(toId);
  if (!a || !b || !ga || !gb) return '';
  const y1 = a.y - ga.boxH / 2;
  const y2 = b.y + gb.boxH / 2;
  const my = (y1 + y2) / 2;
  return `M ${a.x} ${y1} C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${y2}`;
}
function geomOf(id) {
  return current.find((n) => n.id === id) || leaving.find((n) => n.id === id);
}
function build() {
  const drawn = [...current, ...leaving];
  const ids = new Set(drawn.map((n) => n.id));
  edgesG.replaceChildren();
  nodesG.replaceChildren();
  edgeEls = [];
  for (const n of drawn) {
    if (!n.parentId || !ids.has(n.parentId)) continue;
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', (BRANCHES[n.branch] || BRANCHES.its).color);
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.dataset.from = n.parentId;
    path.dataset.to = n.id;
    edgesG.appendChild(path);
    edgeEls.push(path);
  }
  for (const n of drawn) nodesG.appendChild(drawNode(n));
  updatePositions();
}
function updatePositions() {
  cameraG.setAttribute('transform', `translate(${cam.tx} ${cam.ty}) scale(${cam.k})`);
  for (const g of nodesG.children) {
    const v = view.get(g.dataset.id);
    if (!v) continue;
    g.setAttribute('transform', `translate(${v.x} ${v.y})`);
    g.setAttribute('opacity', String(clamp(v.o, 0, 1)));
    g.classList.toggle('is-selected', g.dataset.id === state.selected);
  }
  for (const path of edgeEls) {
    path.setAttribute('d', curve(path.dataset.from, path.dataset.to));
    const child = view.get(path.dataset.to);
    path.setAttribute('opacity', String(clamp(child ? child.o : 0, 0, 1)));
  }
}
function frame(now) {
  const lt = ease(clamp((now - layoutT0) / DUR, 0, 1));
  let moving = (now - layoutT0) < DUR;
  for (const n of current) {
    view.set(n.id, {
      x: n._s.x + (n.x - n._s.x) * lt,
      y: n._s.y + (n.y - n._s.y) * lt,
      o: n._s.o + (n.to - n._s.o) * lt,
    });
  }
  const before = leaving.length;
  leaving = leaving.filter((item) => {
    const t = clamp((now - item.t0) / DUR, 0, 1);
    const e = ease(t);
    const parent = view.get(item.parentId);
    const dx = parent ? parent.x : item._s.x;
    const dy = parent ? parent.y : item._s.y;
    view.set(item.id, {
      x: item._s.x + (dx - item._s.x) * e,
      y: item._s.y + (dy - item._s.y) * e,
      o: item._s.o * (1 - e),
    });
    if (t >= 1) {
      view.delete(item.id);
      return false;
    }
    return true;
  });
  if (leaving.length) moving = true;
  if (leaving.length !== before) lastKey = '';

  const ctElapsed = now - camT0;
  const ct = ease(clamp(ctElapsed / DUR, 0, 1));
  cam.tx = camS.tx + (camD.tx - camS.tx) * ct;
  cam.ty = camS.ty + (camD.ty - camS.ty) * ct;
  cam.k = camS.k + (camD.k - camS.k) * ct;
  if (ctElapsed < DUR) moving = true;

  const key = contentKey();
  if (key !== lastKey) {
    build();
    lastKey = key;
  } else updatePositions();

  raf = moving ? requestAnimationFrame(frame) : 0;
}
function kick() {
  if (!raf) raf = requestAnimationFrame(frame);
}

function pathOf(b) {
  const parts = [];
  let cur = b;
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    parts.unshift(cur.label);
    cur = byId.get(cur.parentId);
  }
  return parts.join('  /  ');
}
function touchedLine(b) {
  if (!b.touched) return 'Last touched —';
  if (b.touched === todayStr()) return 'Last touched — today';
  const [y, m, d] = b.touched.split('-').map(Number);
  if (!y || !m || !d) return 'Last touched —';
  const label = new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
  });
  return `Last touched — ${label}`;
}
function syncMeta(b) {
  if (!b) return;
  crumbEl.textContent = pathOf(b);
  touchedEl.textContent = touchedLine(b);
  touchedEl.classList.toggle('is-today', b.touched === todayStr());
  branchDot.style.background = (BRANCHES[b.branch] || BRANCHES.its).color;
  document.querySelectorAll('#status button').forEach((btn) => {
    btn.classList.toggle('is-on', btn.dataset.status === (b.status || 'none'));
  });
}
function fillPanel(b) {
  fillLock = true;
  labelInput.value = b.label;
  labelInput.classList.toggle('is-hub', HUBS.has(b.id) || b.id === 'nebula');
  subInput.value = b.sub || '';
  noteInput.value = b.note || '';
  branchSel.value = BRANCHES[b.branch] ? b.branch : 'its';
  deleteRow.hidden = false;
  document.getElementById('delete').hidden = b.id === 'nebula';
  addRow.hidden = true;
  confirmEl.hidden = true;
  syncMeta(b);
  fillLock = false;
}
function openPanel() {
  panel.classList.add('is-open');
  panel.inert = false;
  panel.setAttribute('aria-hidden', 'false');
}
function hidePanel() {
  state.selected = null;
  panel.classList.remove('is-open');
  panel.inert = true;
  panel.setAttribute('aria-hidden', 'true');
  confirmEl.hidden = true;
  addRow.hidden = true;
}
function closePanel() {
  hidePanel();
  relayout();
}

let toastTimer = 0;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 2400);
}

async function load() {
  const data = await api('/api/bubbles');
  state.bubbles = (data.bubbles || []).map(norm);
  reindex();
}
function upsert(b) {
  const i = state.bubbles.findIndex((item) => item.id === b.id);
  if (i >= 0) state.bubbles[i] = b;
  else state.bubbles.push(b);
  reindex();
}
function removeSubtree(id) {
  const drop = new Set();
  const walk = (pid) => {
    drop.add(pid);
    children(pid).forEach((c) => walk(c.id));
  };
  walk(id);
  state.bubbles = state.bubbles.filter((b) => !drop.has(b.id));
  reindex();
}

function queue(id, partial, immediate) {
  const b = byId.get(id);
  if (!b) return;
  if (typeof partial.label === 'string') b.label = partial.label;
  if (typeof partial.sub === 'string') b.sub = partial.sub;
  if (typeof partial.note === 'string') b.note = partial.note;
  if (typeof partial.status === 'string') b.status = partial.status;
  if (typeof partial.branch === 'string') b.branch = partial.branch;
  b.touched = todayStr();
  pending.set(id, { ...(pending.get(id) || {}), ...partial });
  relayout();
  if (state.selected === id) syncMeta(b);
  if (immediate) {
    clearTimeout(patchTimer);
    flushPatch(id);
  } else {
    clearTimeout(patchTimer);
    patchTimer = setTimeout(() => flushPatch(id), 280);
  }
}
async function flushPatch(id) {
  const body = pending.get(id);
  pending.delete(id);
  if (!body || !byId.get(id)) return;
  try {
    const updated = norm(await api(`/api/bubbles/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));
    const newer = pending.get(id);
    if (newer) {
      if (typeof newer.label === 'string') updated.label = newer.label;
      if (typeof newer.sub === 'string') updated.sub = newer.sub;
      if (typeof newer.note === 'string') updated.note = newer.note;
      if (typeof newer.status === 'string') updated.status = newer.status;
      if (typeof newer.branch === 'string') updated.branch = newer.branch;
      updated.touched = todayStr();
    }
    upsert(updated);
    relayout();
    if (state.selected === id) syncMeta(byId.get(id));
  } catch (err) {
    toast('Couldn’t save');
    try {
      await load();
      relayout();
      if (state.selected && byId.get(state.selected)) fillPanel(byId.get(state.selected));
    } catch { /* keep the current map */ }
  }
}

function select(id) {
  const b = byId.get(id);
  if (!b) return;
  state.selected = id;
  fillPanel(b);
  openPanel();
  relayout();
}
function setTab(focus) {
  document.querySelectorAll('.tab').forEach((tab) => {
    const on = tab.dataset.focus === focus;
    tab.classList.toggle('is-on', on);
    tab.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}
function setFocus(focus) {
  state.focus = focus;
  setTab(focus);
  relayout({ fit: true });
}
function foldToHubs() {
  state.folded = new Set(
    state.bubbles.filter((b) => b.id !== 'nebula' && children(b.id).length).map((b) => b.id)
  );
}
function toggleFold(id) {
  if (state.folded.has(id)) state.folded.delete(id);
  else state.folded.add(id);
  relayout();
}
function firstMatch() {
  const q = state.query.trim().toLowerCase();
  if (!q) return null;
  const hits = [];
  const walk = (b) => {
    const rank = rankOf(b, q);
    if (rank != null) hits.push({ b, rank, i: hits.length });
    children(b.id).forEach(walk);
  };
  (kids.get(null) || []).forEach(walk);
  hits.sort((a, b) => a.rank - b.rank || a.i - b.i);
  return hits[0] ? hits[0].b : null;
}
function jumpToMatch() {
  const b = firstMatch();
  if (!b) return;
  let parent = byId.get(b.parentId);
  const guard = new Set();
  while (parent && !guard.has(parent.id)) {
    guard.add(parent.id);
    state.folded.delete(parent.id);
    parent = byId.get(parent.parentId);
  }
  state.focus = 'all';
  setTab('all');
  state.selected = b.id;
  fillPanel(b);
  openPanel();
  relayout({ fitId: b.id });
}

async function createChild() {
  const parent = byId.get(state.selected);
  const label = childInput.value.trim();
  if (!parent || !label) return;
  try {
    const created = norm(await api('/api/bubbles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId: parent.id, label, branch: parent.branch }),
    }));
    upsert(created);
    state.folded.delete(parent.id);
    state.selected = created.id;
    childInput.value = '';
    addRow.hidden = true;
    fillPanel(created);
    openPanel();
    relayout({ fitId: created.id });
  } catch (err) {
    toast('Couldn’t add that bubble');
  }
}
async function doDelete() {
  const id = state.selected;
  if (!id || id === 'nebula') return;
  try {
    await api('/api/bubbles/' + encodeURIComponent(id), { method: 'DELETE' });
    removeSubtree(id);
    hidePanel();
    relayout({ fit: true });
  } catch (err) {
    toast('Couldn’t delete that bubble');
  }
}

function buildChrome() {
  const statusRow = document.getElementById('status');
  statusRow.replaceChildren();
  for (const key of ['active', 'waiting', 'done', 'blocked', 'none']) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.status = key;
    if (key !== 'none') {
      const dot = document.createElement('i');
      dot.style.background = STATUS[key].color;
      btn.appendChild(dot);
    }
    btn.append(STATUS[key].label);
    btn.addEventListener('click', () => {
      const b = byId.get(state.selected);
      if (!b || b.status === key) return;
      queue(b.id, { status: key }, true);
    });
    statusRow.appendChild(btn);
  }
  branchSel.replaceChildren();
  for (const [key, value] of Object.entries(BRANCHES)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = value.label;
    branchSel.appendChild(opt);
  }
}

function bind() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => setFocus(tab.dataset.focus));
  });
  document.getElementById('zoomOut').addEventListener('click', () => {
    const { w, h } = viewSize();
    zoomAt(w / 2, h / 2, 1 / 1.12);
  });
  document.getElementById('zoomIn').addEventListener('click', () => {
    const { w, h } = viewSize();
    zoomAt(w / 2, h / 2, 1.12);
  });
  document.getElementById('fit').addEventListener('click', () => {
    const dest = cameraForBounds();
    camS = { tx: cam.tx, ty: cam.ty, k: cam.k };
    camD = dest;
    camT0 = performance.now();
    kick();
  });
  document.getElementById('expand').addEventListener('click', () => {
    state.folded.clear();
    relayout({ fit: true });
  });
  document.getElementById('fold').addEventListener('click', () => {
    foldToHubs();
    relayout({ fit: true });
  });
  search.addEventListener('input', () => {
    state.query = search.value;
    relayout();
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      jumpToMatch();
    }
  });
  document.getElementById('close').addEventListener('click', closePanel);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePanel();
  });
  labelInput.addEventListener('input', () => {
    if (fillLock) return;
    const b = byId.get(state.selected);
    if (!b) return;
    const value = labelInput.value.trim();
    if (!value || value === b.label) return;
    queue(b.id, { label: value }, false);
  });
  subInput.addEventListener('input', () => {
    if (fillLock) return;
    const b = byId.get(state.selected);
    if (!b || subInput.value === b.sub) return;
    queue(b.id, { sub: subInput.value }, false);
  });
  branchSel.addEventListener('change', () => {
    if (fillLock) return;
    const b = byId.get(state.selected);
    if (!b || branchSel.value === b.branch) return;
    queue(b.id, { branch: branchSel.value }, true);
  });
  document.getElementById('saveNote').addEventListener('click', () => {
    const b = byId.get(state.selected);
    if (!b || noteInput.value === (b.note || '')) return;
    queue(b.id, { note: noteInput.value }, true);
  });
  document.getElementById('clearNote').addEventListener('click', () => {
    const b = byId.get(state.selected);
    noteInput.value = '';
    if (!b || !(b.note || '')) return;
    queue(b.id, { note: '' }, true);
  });
  document.getElementById('addChild').addEventListener('click', () => {
    addRow.hidden = false;
    childInput.focus();
  });
  document.getElementById('addConfirm').addEventListener('click', createChild);
  childInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      createChild();
    }
  });
  document.getElementById('delete').addEventListener('click', () => {
    const b = byId.get(state.selected);
    if (!b || b.id === 'nebula') return;
    const extra = children(b.id).length ? ' and everything under it' : '';
    confirmText.textContent = `Delete ${b.label}${extra}?`;
    confirmEl.hidden = false;
  });
  document.getElementById('confirmDelete').addEventListener('click', doDelete);
  document.getElementById('confirmCancel').addEventListener('click', () => {
    confirmEl.hidden = true;
  });

  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('pointercancel', onPointerUp);
  svg.addEventListener('click', onMapClick);
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const factor = Math.exp(-e.deltaY * 0.0015);
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
  }, { passive: false });
  window.addEventListener('resize', () => {
    setCamDest(cam.tx, cam.ty, cam.k, true, { allowSmall: true });
  });
}

let press = null;
function onPointerDown(e) {
  if (e.button != null && e.button !== 0) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      k: cam.k,
      tx: cam.tx,
      ty: cam.ty,
    };
    press = null;
    return;
  }
  const onNode = e.target.closest && e.target.closest('.node, .fold');
  press = {
    id: e.pointerId,
    x: e.clientX,
    y: e.clientY,
    tx: cam.tx,
    ty: cam.ty,
    moved: false,
    node: !!onNode,
    lx: e.clientX,
    ly: e.clientY,
    lt: performance.now(),
    vx: 0,
    vy: 0,
  };
}
function onPointerMove(e) {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size >= 2 && pinch) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const rect = svg.getBoundingClientRect();
    const sx = (a.x + b.x) / 2 - rect.left;
    const sy = (a.y + b.y) / 2 - rect.top;
    const nk = clamp(pinch.k * (dist / pinch.dist), kMin(), kMax());
    const wx = (sx - pinch.tx) / pinch.k;
    const wy = (sy - pinch.ty) / pinch.k;
    const c = clampCam(sx - wx * nk, sy - wy * nk, nk);
    cam = { ...c };
    camS = { ...c };
    camD = { ...c };
    camT0 = performance.now() - DUR;
    updatePositions();
    return;
  }
  if (!press || press.id !== e.pointerId) return;
  const dx = e.clientX - press.x;
  const dy = e.clientY - press.y;
  if (!press.moved && Math.hypot(dx, dy) < 4) return;
  if (!press.moved) {
    press.moved = true;
    suppressClick = true;
    svg.classList.add('is-panning');
    try { svg.setPointerCapture(e.pointerId); } catch { /* already gone */ }
  }
  const now = performance.now();
  const dt = now - press.lt;
  if (dt > 0) {
    press.vx = (e.clientX - press.lx) / dt;
    press.vy = (e.clientY - press.ly) / dt;
  }
  press.lx = e.clientX;
  press.ly = e.clientY;
  press.lt = now;
  const c = clampCam(press.tx + dx, press.ty + dy, cam.k, { allowSmall: true });
  cam = { ...c };
  camS = { ...c };
  camD = { ...c };
  camT0 = performance.now() - DUR;
  updatePositions();
}
function onPointerUp(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  svg.classList.remove('is-panning');
  if (press && press.id === e.pointerId && press.moved) {
    const speed = Math.hypot(press.vx, press.vy);
    if (speed > 0.08) {
      const scale = Math.min(160, speed * 140) / speed;
      setCamDest(cam.tx + press.vx * scale, cam.ty + press.vy * scale, cam.k, false, { allowSmall: true });
    }
  }
  press = null;
}
function onMapClick(e) {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  const fold = e.target.closest && e.target.closest('.fold');
  if (fold) {
    toggleFold(fold.dataset.for);
    return;
  }
  const node = e.target.closest && e.target.closest('.node');
  if (node) {
    select(node.dataset.id);
    return;
  }
  closePanel();
}

function armMidnight() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const ms = Math.max(1000, next - now + 200);
  setTimeout(() => {
    relayout();
    if (state.selected && byId.get(state.selected)) syncMeta(byId.get(state.selected));
    armMidnight();
  }, ms);
}

document.fonts.addEventListener('loadingdone', () => {
  if (!booted) return;
  measureCache.clear();
  relayout();
});

async function boot() {
  try {
    await document.fonts.ready;
    await Promise.all([
      document.fonts.load(FONT.hub),
      document.fonts.load(FONT.bubble),
      document.fonts.load(FONT.sub),
    ]);
  } catch { /* system font is the fallback */ }
  measureCache.clear();
  buildChrome();
  bind();
  try {
    await load();
  } catch (err) {
    toast('The map didn’t load');
    return;
  }
  foldToHubs();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  relayout({ snap: true, fit: true, jump: true });
  svg.classList.add('is-ready');
  booted = true;
  armMidnight();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    relayout();
    if (state.selected && byId.get(state.selected)) syncMeta(byId.get(state.selected));
  });
}

boot();
