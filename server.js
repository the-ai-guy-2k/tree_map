// TAIG Tree Map Live — Express + node:sqlite backend.
// Persistent tree: bubbles, notes, statuses, touched dates.
// Runs with: npm install && npm start   (PORT env or 3000)
const express = require('express');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'tree.db');

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS bubbles (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    label TEXT NOT NULL,
    sub TEXT DEFAULT '',
    branch TEXT DEFAULT 'its',
    status TEXT DEFAULT '',
    note TEXT DEFAULT '',
    touched TEXT DEFAULT '',
    sort INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_parent ON bubbles(parent_id);
`);

function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function newId() {
  return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Seed on first run only — never overwrites user data.
function seedIfEmpty() {
  const row = db.prepare('SELECT COUNT(*) AS cnt FROM bubbles').get();
  if (row.cnt > 0) return;
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed.json'), 'utf8'));
  const ins = db.prepare(
    'INSERT INTO bubbles (id, parent_id, label, sub, branch, status, note, touched, sort) VALUES (?,?,?,?,?,?,?,?,?)'
  );
  seed.bubbles.forEach((b, i) => {
    ins.run(b.id, b.parent_id || null, b.label, b.sub || '', b.branch || 'its',
      b.status || '', b.note || '', b.touched || '', b.sort ?? i);
  });
  console.log(`Seeded ${seed.bubbles.length} bubbles`);
}
seedIfEmpty();

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const ALLOWED_STATUS = new Set(['', 'active', 'waiting', 'done', 'blocked']);

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.get('/api/bubbles', (req, res) => {
  const rows = db.prepare('SELECT * FROM bubbles ORDER BY sort, label').all();
  res.json({ bubbles: rows });
});

app.post('/api/bubbles', (req, res) => {
  const { parent_id = null, label = 'New bubble', sub = '', branch = 'its' } = req.body || {};
  if (!label || !label.trim()) return res.status(400).json({ error: 'label required' });
  const id = newId();
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM bubbles WHERE parent_id IS ?').get(parent_id);
  db.prepare('INSERT INTO bubbles (id, parent_id, label, sub, branch, touched, sort) VALUES (?,?,?,?,?,?,?)')
    .run(id, parent_id, label.trim(), sub, branch, todayStr(), (maxSort ? maxSort.m : -1) + 1);
  // Parent was worked on too.
  if (parent_id) db.prepare('UPDATE bubbles SET touched = ? WHERE id = ?').run(todayStr(), parent_id);
  res.status(201).json(db.prepare('SELECT * FROM bubbles WHERE id = ?').get(id));
});

app.patch('/api/bubbles/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM bubbles WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  const next = {
    label: typeof b.label === 'string' && b.label.trim() ? b.label.trim() : cur.label,
    sub: typeof b.sub === 'string' ? b.sub : cur.sub,
    branch: typeof b.branch === 'string' ? b.branch : cur.branch,
    status: typeof b.status === 'string' && ALLOWED_STATUS.has(b.status) ? b.status : cur.status,
    note: typeof b.note === 'string' ? b.note : cur.note,
    parent_id: b.parent_id === null || typeof b.parent_id === 'string' ? b.parent_id : cur.parent_id,
    touched: typeof b.touched === 'string' ? b.touched : todayStr(), // any edit = worked today
  };
  if (next.parent_id === cur.id) return res.status(400).json({ error: 'cannot parent to self' });
  db.prepare('UPDATE bubbles SET label=?, sub=?, branch=?, status=?, note=?, parent_id=?, touched=? WHERE id=?')
    .run(next.label, next.sub, next.branch, next.status, next.note, next.parent_id, next.touched, cur.id);
  res.json(db.prepare('SELECT * FROM bubbles WHERE id = ?').get(cur.id));
});

app.delete('/api/bubbles/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM bubbles WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'not found' });
  if (cur.id === 'nebula') return res.status(400).json({ error: 'cannot delete the Nebula base' });
  // Collect subtree.
  const all = db.prepare('SELECT id, parent_id FROM bubbles').all();
  const kids = new Map();
  all.forEach(r => {
    if (!kids.has(r.parent_id)) kids.set(r.parent_id, []);
    kids.get(r.parent_id).push(r.id);
  });
  const doomed = [cur.id];
  for (let i = 0; i < doomed.length; i++) {
    (kids.get(doomed[i]) || []).forEach(k => doomed.push(k));
  }
  const del = db.prepare('DELETE FROM bubbles WHERE id = ?');
  doomed.forEach(id => del.run(id));
  res.json({ deleted: doomed });
});

// Full JSON export (backup / inspection).
app.get('/api/export', (req, res) => {
  const rows = db.prepare('SELECT * FROM bubbles ORDER BY sort').all();
  res.setHeader('Content-Disposition', 'attachment; filename="tree-export.json"');
  res.json({ exported_at: new Date().toISOString(), bubbles: rows });
});

app.listen(PORT, () => console.log(`TAIG Tree Map Live on :${PORT}`));
