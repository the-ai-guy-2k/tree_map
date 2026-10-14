// Static checks the CI structure job runs before anything can merge to deployable.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const failures = [];

function must(condition, message) {
  if (!condition) failures.push(message);
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
must(pkg.scripts && typeof pkg.scripts.start === 'string' && pkg.scripts.start.trim() === 'node server.js',
  'package.json needs a start script of "node server.js"');
must(pkg.engines && typeof pkg.engines.node === 'string' && pkg.engines.node.includes('22'),
  'package.json engines.node must allow Node 22+');

const replit = fs.existsSync(path.join(root, '.replit'))
  ? fs.readFileSync(path.join(root, '.replit'), 'utf8')
  : '';
must(/npm start/.test(replit), '.replit must exist and set the run command to npm start');

const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
must(ignore.split(/\r?\n/).includes('node_modules/'), '.gitignore must cover node_modules/');
must(ignore.split(/\r?\n/).includes('data/*.db'), '.gitignore must cover data/*.db');

const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
must(server.includes('process.env.PORT || 3000'), 'server must bind process.env.PORT || 3000');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('structure ok');
