const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  baseUrl,
  ensureIsolatedEnv,
  startServer,
  stopServer,
  restartServer,
  waitForHealth,
} = require('./server-process');

function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

async function api(pathname, options) {
  const res = await fetch(`${baseUrl()}${pathname}`, options);
  const text = await res.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return { status: res.status, body };
}

async function bubbles() {
  const res = await api('/api/bubbles');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.bubbles));
  return res.body.bubbles;
}

before(async () => {
  ensureIsolatedEnv();
  try {
    await waitForHealth(baseUrl(), 5);
  } catch {
    startServer();
    await waitForHealth();
  }
});

after(async () => {
  if (process.env.KEEP_SERVER === '1') return;
  await stopServer();
  if (process.env.TREE_DB) fs.rmSync(process.env.TREE_DB, { force: true });
});

test('tree map API', { timeout: 120000 }, async (t) => {
  let createdId = '';

  await t.test('GET /api/health returns ok', async () => {
    const res = await api('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  await t.test('seed is idempotent across a restart', async () => {
    const first = await bubbles();
    assert.equal(first.length, 45);
    assert.equal(new Set(first.map((b) => b.id)).size, first.length);
    await restartServer();
    const second = await bubbles();
    assert.equal(second.length, first.length);
    assert.deepEqual(second.map((b) => b.id).sort(), first.map((b) => b.id).sort());
    assert.equal(new Set(second.map((b) => b.id)).size, second.length);
  });

  await t.test('POST /api/bubbles creates under a parent and stamps today', async () => {
    const res = await api('/api/bubbles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentId: 'cott', label: 'CI child', sub: 'created by the suite' }),
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.parentId, 'cott');
    assert.equal(res.body.label, 'CI child');
    assert.equal(res.body.touched, todayStr());
    assert.ok(res.body.id);
    createdId = res.body.id;
    const all = await bubbles();
    assert.ok(all.some((b) => b.id === createdId && b.parentId === 'cott'));
  });

  await t.test('PATCH updates a note and the note survives a restart', async () => {
    assert.ok(createdId);
    const patched = await api(`/api/bubbles/${createdId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'persisted by the suite' }),
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.note, 'persisted by the suite');
    assert.equal(patched.body.touched, todayStr());
    const beforeRestart = (await bubbles()).length;
    await restartServer();
    const after = await bubbles();
    const saved = after.find((b) => b.id === createdId);
    assert.ok(saved);
    assert.equal(saved.note, 'persisted by the suite');
    assert.equal(after.length, beforeRestart);
  });

  await t.test('DELETE removes the bubble and its subtree', async () => {
    const child = await api('/api/bubbles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentId: createdId, label: 'CI grandchild' }),
    });
    assert.equal(child.status, 201);
    const removed = await api(`/api/bubbles/${createdId}`, { method: 'DELETE' });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.id, createdId);
    const all = await bubbles();
    assert.equal(all.some((b) => b.id === createdId), false);
    assert.equal(all.some((b) => b.id === child.body.id), false);
    assert.ok(all.some((b) => b.id === 'cott'));
  });

  await t.test('DELETE on Nebula is refused and the base remains', async () => {
    const res = await api('/api/bubbles/nebula', { method: 'DELETE' });
    assert.equal(res.status, 400);
    const all = await bubbles();
    assert.ok(all.some((b) => b.id === 'nebula'));
  });

  await t.test('unknown ids return 404 and never 500', async () => {
    const patched = await api('/api/bubbles/no-such-bubble', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'nope' }),
    });
    const removed = await api('/api/bubbles/no-such-bubble', { method: 'DELETE' });
    assert.equal(patched.status, 404);
    assert.equal(removed.status, 404);
    assert.notEqual(patched.status, 500);
    assert.notEqual(removed.status, 500);
  });
});
