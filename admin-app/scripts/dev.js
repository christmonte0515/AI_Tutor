const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const electronCli = path.join(root, 'node_modules', 'electron', 'cli.js');

let child = null;
let timer = null;

function ignored(filename) {
  if (!filename) return true;
  const name = String(filename).replaceAll('\\', '/');
  return name.includes('node_modules') || name.startsWith('.git');
}

function launch() {
  const proc = spawn(process.execPath, [electronCli, '.'], { cwd: root, stdio: 'inherit' });
  child = proc;
  proc.on('exit', () => {
    if (child === proc) child = null;
  });
}

function restart() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const current = child;
    if (!current || current.exitCode !== null) {
      launch();
      return;
    }
    console.log('File saved. Restarting...');
    let started = false;
    const next = () => {
      if (started) return;
      started = true;
      if (child === current) child = null;
      launch();
    };
    const killer = spawn('taskkill', ['/pid', String(current.pid), '/t', '/f'], { stdio: 'ignore' });
    killer.on('exit', next);
    current.on('exit', next);
  }, 300);
}

fs.watch(root, { recursive: true }, (_event, filename) => {
  if (ignored(filename)) return;
  restart();
});

console.log('Watching for saves in the teacher app. Ctrl+S restarts the window.');
launch();
