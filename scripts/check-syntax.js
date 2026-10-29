const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const files = [
  ['server.js', false],
  ['db/database.js', false],
  ['routes/articles.js', false],
  ['routes/refresh.js', false],
  ['routes/sources.js', false],
  ['services/safeFetch.js', false],
  ['services/refreshGuard.js', false],
  ['services/feedFetcher.js', false],
  ['services/articlePreview.js', false],
  ['services/articleImageProxy.js', false],
  ['public/js/api.js', true],
  ['public/js/app.js', true],
  ['public/js/ui.js', true],
  ['services/textCleanup.js', false],
  ['services/scheduler.js', false],
  ['scripts/check-syntax.js', false],
];

let failed = false;
for (const [relativePath, isModule] of files) {
  const absolutePath = path.join(root, relativePath);
  const args = isModule
    ? ['--input-type=module', '--check']
    : ['--check', absolutePath];
  const options = {
    cwd: root,
    encoding: 'utf8',
    ...(isModule ? { input: fs.readFileSync(absolutePath, 'utf8') } : {}),
  };
  const result = spawnSync(process.execPath, args, options);
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(`Syntax check failed: ${relativePath}\n`);
    process.stderr.write(result.stderr || result.error?.message || 'Unknown error\n');
  } else {
    process.stdout.write(`OK ${relativePath}\n`);
  }
}

if (failed) process.exitCode = 1;
