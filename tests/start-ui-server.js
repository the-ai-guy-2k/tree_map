// Playwright's own server. A fresh temp database so a lone `playwright test` cannot touch data/tree.db.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const db = path.join(os.tmpdir(), `taig-ui-${process.pid}.db`);
fs.rmSync(db, { force: true });
const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, PORT: '3462', TREE_DB: db },
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code == null ? 0 : code));
