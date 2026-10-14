/* TAIG Tree Map Live — frontend.
   Bottom-up tree: Nebula oval at the base, four domains rising from it.
   All bubble data persists via /api/bubbles (SQLite). */
'use strict';

const BRANCHES = {
  nebula:   { label: 'Nebula — base',   color: '#1e293b' },
  its:      { label: 'TAIG ITS',        color: '#16a34a' },
  taig2k:   { label: 'TAIG 2K software', color: '#15803d' },
  services: { label: 'TAIG Services',   color: '#0d9488' },
  duval:    { label: 'Job / Duval',     color: '#0891b2' },
  funding:  { label: 'Funding',         color: '#ea580c' },
  clients:  { label: 'Clients',         color: '#2563eb' },
  c3:       { label: 'C³ Reports',      color: '#dc2626' },
  ideas:    { label: 'Ideas',           color: '#d97706' },
  social:   { label: 'Social',          color: '#ca8a04' },
  promo:    { label: 'Album / Promo',   color: '#7c3aed' },
  future:   { label: 'Future Clients',  color: '#4f46e5' },
  tan:      { label: 'TAIG TAN',        color: '#65a30d' },
  cott:     { label: 'COTT label',      color: '#4d7c0f' },
};
const DOMAINS = [
  { id: 'its', label: 'TAIG ITS' },
  { id: 'promo', label: 'TAIG Promo' },
  { id: 'tan', label: 'TAIG TAN' },
  { id: 'cott', label: 'COTT' },
];
const STATUS_LABEL = { active: 'Active', waiting: 'Waiting', done: 'Done', blocked: 'Blocked' };

const W = 200, HGAP = 30, VGAP = 120, NODE_H = 70;

const state = {
  bubbles: [], byId: new Map(),
  folded: new Set(), focus: 'all', query: '',
  selected: null, k: 1, tx: 0, ty: 0,
};

const svg = document.getElementById('map');
const NS = 'http://www.w3.org/2000/svg';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- API ---------- */
async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(`${opts?.method || 'GET'} ${path} → ${r.status}`);
  return r.json();
}
async function loadBubbles() {
  const d = await api('/api/bubbles');
  state.bubbles = d.bubbles;
  state.byId = new Map(d.bubbles.map(b => [b.id, b]));
}
async function saveBubble(id, patch) {
  const b = await api(`/api/bubbles/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  state.byId.set(id, b);
  const i = state.bubbles.findIndex(x => x.id === id);
  if (i >= 0) state.bubbles[i] = b;
  return b;
}

/* ---------- tree model ---------- */
function kidsOf(id) { return state.bubbles.filter(b => b.parent_id === id).sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label)); }
function inFocus(b) {
  if (state.focus === 'all') return true;
  let cur = b;
  while (cur) { if (cur.id === state.focus) return true; cur = state.byId.get(cur.parent_id); }
  return false;
}
function visKids(id) {
  if (state.folded.has(id)) return [];
  return kidsOf(id).filter(k => id === 'nebula' ? inFocus(k) : inFocus(k));
}

let pos = new Map(); // id -> {x, depth}
function layout() {
  pos = new Map();
  function place(id, x, depth) {
    const k = visKids(id);
    if (!k.length) { pos.set(id, { x: x * (W + HGAP), depth }); return x + 1; }
    let cx = x;
    for (const c of k) cx = place(c.id, cx, depth + 1);
    const xs = k.map(c => pos.get(c.id).x);
    pos.set(id, { x: (Math.min(...xs) + Math.max(...xs)) / 2, depth });
    return cx;
  }
  if (state.byId.has('nebula')) place('nebula', 0, 0);
}
const yOf = d => -d * VGAP;

/* ---------- render ---------- */
function branchColor(b) { return (BRANCHES[b.branch] || BRANCHES.its).color; }
function isToday(b) { return b.touched === todayStr(); }

function render() {
  layout();
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  if (!pos.size) return;

  const g = document.createElementNS(NS, 'g');
  g.setAttribute('id', 'viewport');
  g.setAttribute('transform', `translate(${state.tx},${state.ty}) scale(${state.k})`);
  svg.appendChild(g);

  const q = state.query.trim().toLowerCase();
  const matchIds = new Set();
  if (q) state.bubbles.forEach(b => {
    if ((b.label + ' ' + (b.sub || '') + ' ' + (b.note || '')).toLowerCase().includes(q)) matchIds.add(b.id);
  });

  // edges
  for (const [id, p] of pos) {
    const b = state.byId.get(id);
    if (!b || !b.parent_id || !pos.has(b.parent_id)) continue;
    const pp = pos.get(b.parent_id);
    const path = document.createElementNS(NS, 'path');
    const x1 = pp.x, y1 = yOf(pp.depth) - NODE_H / 2;
    const x2 = p.x, y2 = yOf(p.depth) + NODE_H / 2;
    const my = (y1 + y2) / 2;
    path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`);
    path.setAttribute('class', 'edge');
    g.appendChild(path);
  }

  // nodes
  for (const [id, p] of pos) {
    const b = state.byId.get(id);
    if (!b) continue;
    const y = yOf(p.depth);

    if (id === 'nebula') {
      const e = document.createElementNS(NS, 'ellipse');
      e.setAttribute('cx', p.x); e.setAttribute('cy', y);
      e.setAttribute('rx', 120); e.setAttribute('ry', 34);
      e.setAttribute('class', 'nebula-oval');
      e.style.cursor = 'pointer';
      e.addEventListener('click', () => select(id));
      g.appendChild(e);
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', p.x); t.setAttribute('y', y + 5);
      t.setAttribute('class', 'nebula-label');
      t.textContent = 'Nebula';
      t.style.pointerEvents = 'none';
      g.appendChild(t);
      continue;
    }

    const node = document.createElementNS(NS, 'g');
    const fo = document.createElementNS(NS, 'foreignObject');
    fo.setAttribute('x', p.x - W / 2); fo.setAttribute('y', y - NODE_H / 2);
    fo.setAttribute('width', W); fo.setAttribute('height', NODE_H + 30);

    const div = document.createElement('div');
    div.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    let cls = 'bubble';
    if (q) cls += matchIds.has(id) ? ' match' : ' dim';
    if (state.selected === id) cls += ' selected';
    div.setAttribute('class', cls);
    div.style.borderColor = branchColor(b);
    div.innerHTML =
      `<div class="b-label">${esc(b.label)}</div>` +
      (b.sub ? `<div class="b-sub">${esc(b.sub)}</div>` : '') +
      `<div class="b-tags">` +
      (isToday(b) ? `<span class="tag-today">TODAY</span>` : '') +
      (b.status && STATUS_LABEL[b.status] ? `<span class="dot ${b.status}" title="${STATUS_LABEL[b.status]}"></span>` : '') +
      (b.note ? `<span class="tag-note" title="Has a note">✎</span>` : '') +
      `</div>`;
    div.addEventListener('click', ev => { ev.stopPropagation(); select(id); });
    fo.appendChild(div);
    node.appendChild(fo);

    const k = visKids(id);
    const allKids = kidsOf(id).filter(x => inFocus(x));
    if (allKids.length) {
      const fb = document.createElementNS(NS, 'g');
      fb.setAttribute('class', 'foldbtn');
      const folded = state.folded.has(id);
      const cx = p.x + W / 2 - 2, cy = y + NODE_H / 2 - 2;
      fb.innerHTML = `<circle cx="${cx}" cy="${cy}" r="11"></circle><text x="${cx}" y="${cy + 4}">${folded ? '+' : '−'}</text>`;
      fb.addEventListener('click', ev => { ev.stopPropagation(); toggleFold(id); });
      const title = document.createElementNS(NS, 'title');
      title.textContent = folded ? `Expand (${allKids.length})` : 'Fold branch';
      fb.appendChild(title);
      node.appendChild(fb);
    }
    g.appendChild(node);
  }
}

function applyTransform() {
  const g = svg.querySelector('#viewport');
  if (g) g.setAttribute('transform', `translate(${state.tx},${state.ty}) scale(${state.k})`);
}

function fit() {
  if (!pos.size) return;
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const [, p] of pos) {
    minX = Math.min(minX, p.x - W / 2 - 40); maxX = Math.max(maxX, p.x + W / 2 + 40);
    minY = Math.min(minY, yOf(p.depth) - 80); maxY = Math.max(maxY, yOf(p.depth) + 80);
  }
  const r = svg.getBoundingClientRect();
  const k = Math.min(r.width / (maxX - minX), r.height / (maxY - minY), 1.4);
  state.k = k;
  state.tx = r.width / 2 - ((minX + maxX) / 2) * k;
  state.ty = r.height / 2 - ((minY + maxY) / 2) * k;
  applyTransform();
}

/* ---------- pan / zoom ---------- */
(function () {
  let drag = null;
  svg.addEventListener('pointerdown', e => {
    if (e.target.closest('.bubble') || e.target.closest('.foldbtn')) return;
    drag = { x: e.clientX, y: e.clientY, tx: state.tx, ty: state.ty };
    svg.classList.add('dragging');
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', e => {
    if (!drag) return;
    state.tx = drag.tx + (e.clientX - drag.x);
    state.ty = drag.ty + (e.clientY - drag.y);
    applyTransform();
  });
  const end = () => { drag = null; svg.classList.remove('dragging'); };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const k2 = Math.min(2.5, Math.max(0.25, state.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    state.tx = mx - (mx - state.tx) * (k2 / state.k);
    state.ty = my - (my - state.ty) * (k2 / state.k);
    state.k = k2;
    applyTransform();
  }, { passive: false });
  svg.addEventListener('click', e => {
    if (e.target === svg) select(null);
  });
})();

/* ---------- selection + detail panel ---------- */
const panel = document.getElementById('panel');
function pathOf(b) {
  const parts = [];
  let cur = b;
  while (cur) { parts.unshift(cur.label); cur = state.byId.get(cur.parent_id); }
  return parts.join(' → ');
}
function select(id) {
  state.selected = id;
  render();
  if (!id) { panel.classList.add('hidden'); return; }
  const b = state.byId.get(id);
  if (!b) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  document.getElementById('pEyebrow').textContent = (BRANCHES[b.branch] || BRANCHES.its).label.toUpperCase();
  document.getElementById('pLabel').value = b.label;
  document.getElementById('pSub').value = b.sub || '';
  document.getElementById('pPath').textContent = 'PATH FROM NEBULA — ' + pathOf(b);
  document.getElementById('pToday').classList.toggle('hidden', !isToday(b));
  document.getElementById('pNote').value = b.note || '';
  const br = document.getElementById('pBranch');
  br.innerHTML = Object.entries(BRANCHES).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
  br.value = b.branch || 'its';
  document.querySelectorAll('#pStatus button').forEach(btn => btn.classList.toggle('on', btn.dataset.status === (b.status || '')));
  const dstr = b.touched ? new Date(b.touched + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  document.getElementById('pMeta').textContent = `Last touched: ${dstr}${b.note ? ' · ✎ noted' : ''}`;
}
document.getElementById('panelClose').addEventListener('click', () => select(null));

let saveTimer = null;
function queueSave(patch) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const id = state.selected;
      if (!id) return;
      const b = await saveBubble(id, patch);
      render(); selectRefreshMeta(b);
    } catch (e) { toast('Save failed: ' + e.message); }
  }, 450);
}
function selectRefreshMeta(b) {
  const dstr = b.touched ? new Date(b.touched + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  document.getElementById('pMeta').textContent = `Last touched: ${dstr}${b.note ? ' · ✎ noted' : ''}`;
  document.getElementById('pToday').classList.toggle('hidden', !isToday(b));
  document.getElementById('pEyebrow').textContent = (BRANCHES[b.branch] || BRANCHES.its).label.toUpperCase();
}
document.getElementById('pLabel').addEventListener('input', e => queueSave({ label: e.target.value }));
document.getElementById('pSub').addEventListener('input', e => queueSave({ sub: e.target.value }));
document.getElementById('pNote').addEventListener('input', e => queueSave({ note: e.target.value }));
document.getElementById('pBranch').addEventListener('change', e => queueSave({ branch: e.target.value }));
document.querySelectorAll('#pStatus button').forEach(btn =>
  btn.addEventListener('click', () => queueSave({ status: btn.dataset.status })));

document.getElementById('pFold').addEventListener('click', () => { if (state.selected) toggleFold(state.selected); });
document.getElementById('pAddChild').addEventListener('click', async () => {
  const id = state.selected; if (!id) return;
  const b = state.byId.get(id);
  const label = prompt(`New bubble under “${b.label}”:`, '');
  if (label === null) return;
  try {
    const created = await api('/api/bubbles', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent_id: id, label: label.trim() || 'New bubble', branch: b.branch }),
    });
    state.bubbles.push(created); state.byId.set(created.id, created);
    state.folded.delete(id);
    render(); select(created.id); toast('Bubble added');
  } catch (e) { toast('Add failed: ' + e.message); }
});
document.getElementById('pDelete').addEventListener('click', async () => {
  const id = state.selected; if (!id) return;
  const b = state.byId.get(id);
  const n = countSubtree(id);
  if (!confirm(`Delete “${b.label}”${n > 1 ? ` and its ${n - 1} child bubble(s)` : ''}?`)) return;
  try {
    const d = await api(`/api/bubbles/${id}`, { method: 'DELETE' });
    d.deleted.forEach(x => { state.byId.delete(x); });
    state.bubbles = state.bubbles.filter(x => !d.deleted.includes(x.id));
    select(null); render(); toast('Deleted');
  } catch (e) { toast('Delete failed: ' + e.message); }
});
function countSubtree(id) {
  let n = 1;
  kidsOf(id).forEach(k => { n += countSubtree(k.id); });
  return n;
}
function toggleFold(id) {
  state.folded.has(id) ? state.folded.delete(id) : state.folded.add(id);
  render();
}

/* ---------- toolbar ---------- */
document.querySelectorAll('#tabs .tab').forEach(t =>
  t.addEventListener('click', () => {
    document.querySelectorAll('#tabs .tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    state.focus = t.dataset.focus;
    render(); fit();
  }));
document.getElementById('fitBtn').addEventListener('click', fit);
document.getElementById('expandBtn').addEventListener('click', () => { state.folded.clear(); render(); });
document.getElementById('foldBtn').addEventListener('click', () => {
  state.folded = new Set(DOMAINS.map(d => d.id));
  render();
});
const searchInput = document.getElementById('search');
searchInput.addEventListener('input', () => { state.query = searchInput.value; render(); });
searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && state.query.trim()) {
    const q = state.query.trim().toLowerCase();
    const hit = state.bubbles.find(b => (b.label + ' ' + (b.sub || '')).toLowerCase().includes(q) && pos.has(b.id));
    if (hit) { select(hit.id); centerOn(hit.id); }
  }
});
function centerOn(id) {
  const p = pos.get(id); if (!p) return;
  const r = svg.getBoundingClientRect();
  state.k = Math.max(state.k, 1);
  state.tx = r.width / 2 - p.x * state.k;
  state.ty = r.height / 2 - yOf(p.depth) * state.k;
  applyTransform();
}

let toastTimer = null;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
}

/* ---------- legend ---------- */
(function () {
  const rows = document.getElementById('legendRows');
  rows.innerHTML = Object.entries(BRANCHES).map(([k, v]) =>
    `<span><i class="dot" style="background:${v.color}"></i>${esc(v.label)}</span>`).join('') +
    `<span><span class="tag-today">TODAY</span>touched today</span>`;
})();

/* ---------- boot ---------- */
(async function boot() {
  try {
    await loadBubbles();
    // default: fold to domains like the classic view
    state.folded = new Set(DOMAINS.map(d => d.id));
    render();
    fit();
  } catch (e) {
    toast('Failed to load tree: ' + e.message);
  }
})();
window.addEventListener('resize', () => render());
