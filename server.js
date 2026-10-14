// TAIG Tree Map Live — Express + node:sqlite.
// Seed runs only when the database is empty. Existing notes are never wiped.
const express = require('express');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'tree.db');

const BRANCHES = new Set([
  'nebula', 'its', 'taig2k', 'services', 'duval', 'funding', 'clients',
  'c3', 'ideas', 'social', 'promo', 'future', 'tan', 'cott',
]);
const STATUSES = new Set(['active', 'waiting', 'done', 'blocked', 'none']);

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

function apiStatus(stored) {
  if (!stored || stored === 'none') return 'none';
  return STATUSES.has(stored) ? stored : 'none';
}

function storeStatus(status) {
  return !status || status === 'none' ? '' : status;
}

function rowToBubble(row) {
  if (!row) return null;
  return {
    id: row.id,
    label: row.label,
    sub: row.sub || '',
    branch: row.branch || 'its',
    parentId: row.parent_id || null,
    touched: row.touched || '',
    note: row.note || '',
    status: apiStatus(row.status),
    sort: row.sort ?? 0,
  };
}

function seedIfEmpty() {
  const row = db.prepare('SELECT COUNT(*) AS cnt FROM bubbles').get();
  if (row.cnt > 0) return;
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed.json'), 'utf8'));
  const ins = db.prepare(
    'INSERT INTO bubbles (id, parent_id, label, sub, branch, status, note, touched, sort) VALUES (?,?,?,?,?,?,?,?,?)'
  );
  seed.bubbles.forEach((b, i) => {
    ins.run(
      b.id, b.parent_id || null, b.label, b.sub || '', b.branch || 'its',
      b.status || '', b.note || '', b.touched || '', b.sort ?? i
    );
  });
  console.log(`Seeded ${seed.bubbles.length} bubbles`);
}
seedIfEmpty();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function readBubble(id) {
  return db.prepare('SELECT * FROM bubbles WHERE id = ?').get(id);
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/api/bubbles', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM bubbles ORDER BY sort, label').all();
    res.json({ bubbles: rows.map(rowToBubble) });
  } catch (err) {
    res.status(400).json({ error: 'bad request' });
  }
});

app.post('/api/bubbles', (req, res) => {
  try {
    const b = req.body || {};
    const parentId = b.parentId === undefined ? (b.parent_id ?? null) : b.parentId;
    const label = typeof b.label === 'string' ? b.label.trim() : '';
    if (!label) return res.status(400).json({ error: 'label required' });
    if (!parentId || typeof parentId !== 'string') return res.status(400).json({ error: 'parent required' });
    const parent = readBubble(parentId);
    if (!parent) return res.status(404).json({ error: 'not found' });
    const branch = typeof b.branch === 'string' && BRANCHES.has(b.branch) ? b.branch : (parent.branch || 'its');
    const sub = typeof b.sub === 'string' ? b.sub : '';
    const id = newId();
    const maxSort = db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM bubbles WHERE parent_id IS ?').get(parentId);
    const sort = (maxSort ? maxSort.m : -1) + 1;
    const touched = todayStr();
    db.prepare(
      'INSERT INTO bubbles (id, parent_id, label, sub, branch, status, note, touched, sort) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(id, parentId, label, sub, branch, '', '', touched, sort);
    db.prepare('UPDATE bubbles SET touched = ? WHERE id = ?').run(touched, parentId);
    res.status(201).json(rowToBubble(readBubble(id)));
  } catch (err) {
    res.status(400).json({ error: 'bad request' });
  }
});

app.patch('/api/bubbles/:id', (req, res) => {
  try {
    const cur = readBubble(req.params.id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    const b = req.body || {};
    const next = {
      label: cur.label,
      sub: cur.sub || '',
      branch: cur.branch || 'its',
      status: apiStatus(cur.status),
      note: cur.note || '',
    };
    if (typeof b.label === 'string') {
      const label = b.label.trim();
      if (!label) return res.status(400).json({ error: 'label required' });
      next.label = label;
    }
    if (typeof b.sub === 'string') next.sub = b.sub;
    if (typeof b.note === 'string') next.note = b.note;
    if (typeof b.branch === 'string') {
      if (!BRANCHES.has(b.branch)) return res.status(400).json({ error: 'bad branch' });
      next.branch = b.branch;
    }
    if (typeof b.status === 'string') {
      if (!STATUSES.has(b.status)) return res.status(400).json({ error: 'bad status' });
      next.status = b.status;
    }
    const touched = todayStr();
    db.prepare(
      'UPDATE bubbles SET label=?, sub=?, branch=?, status=?, note=?, touched=? WHERE id=?'
    ).run(next.label, next.sub, next.branch, storeStatus(next.status), next.note, touched, cur.id);
    res.json(rowToBubble(readBubble(cur.id)));
  } catch (err) {
    res.status(400).json({ error: 'bad request' });
  }
});

app.delete('/api/bubbles/:id', (req, res) => {
  try {
    const cur = readBubble(req.params.id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    if (cur.id === 'nebula') return res.status(400).json({ error: 'cannot delete the Nebula base' });
    const snapshot = rowToBubble(cur);
    const all = db.prepare('SELECT id, parent_id FROM bubbles').all();
    const kids = new Map();
    all.forEach((r) => {
      if (!kids.has(r.parent_id)) kids.set(r.parent_id, []);
      kids.get(r.parent_id).push(r.id);
    });
    const doomed = [cur.id];
    for (let i = 0; i < doomed.length; i++) {
      (kids.get(doomed[i]) || []).forEach((k) => doomed.push(k));
    }
    const del = db.prepare('DELETE FROM bubbles WHERE id = ?');
    doomed.forEach((id) => del.run(id));
    res.json(snapshot);
  } catch (err) {
    res.status(400).json({ error: 'bad request' });
  }
});

app.get('/api/export', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM bubbles ORDER BY sort, label').all();
    res.json({ exportedAt: new Date().toISOString(), bubbles: rows.map(rowToBubble) });
  } catch (err) {
    res.status(400).json({ error: 'bad request' });
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'not found' });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  res.status(400).json({ error: 'bad request' });
});

app.listen(PORT, () => console.log(`TAIG Tree Map Live on :${PORT}`));
