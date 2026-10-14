// `npm test` starts an isolated server, runs the API suite, then the UI suite, then stops the server.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  ensureIsolatedEnv,
  startServer,
  stopServer,
  waitForHealth,
} = require('./server-process');

const root = path.join(__dirname, '..');
const scope = process.env.TEST_SCOPE || 'all';
const ownsServer = scope !== 'ui' || !process.env.BASE_URL;

function playwright(args) {
  const cli = require.resolve('@playwright/test/cli');
  return spawn(process.execPath, [cli, ...args], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
}

function exitCode(child) {
  return new Promise((resolve) => child.on('exit', (code) => resolve(code == null ? 1 : code)));
}

async function main() {
  if (ownsServer) {
    process.env.BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3461';
    process.env.TREE_DB = process.env.TREE_DB || path.join(os.tmpdir(), `taig-npm-test-${process.pid}.db`);
    process.env.SERVER_PID_FILE = process.env.SERVER_PID_FILE || `${process.env.TREE_DB}.pid`;
    process.env.KEEP_SERVER = '1';
    fs.rmSync(process.env.TREE_DB, { force: true });
    delete process.env.SHARED_JSON_PATH;
    ensureIsolatedEnv();
    startServer();
    await waitForHealth();
  }

  let status = 0;
  try {
    if (scope === 'api' || scope === 'all') {
      const api = spawn(process.execPath, ['--test', '--test-concurrency=1', 'tests/api.test.js', 'tests/sync.test.js'], {
        cwd: root,
        env: process.env,
        stdio: 'inherit',
      });
      status = await exitCode(api);
    }
    if (status === 0 && (scope === 'ui' || scope === 'all')) {
      if (scope === 'all') {
        const install = playwright(['install', 'chromium']);
        const installStatus = await exitCode(install);
        if (installStatus) return installStatus;
      }
      status = await exitCode(playwright(['test']));
    }
    return status;
  } finally {
    if (ownsServer) {
      await stopServer();
      const db = process.env.TREE_DB;
      if (db) {
        for (let i = 0; i < 20; i++) {
          try {
            fs.rmSync(db, { force: true });
            break;
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
      }
    }
  }
}

main().then(
  (code) => process.exit(code || 0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
