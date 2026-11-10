import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const syntaxTargets = [
  'src/clock.mjs',
  'src/content/circuit-questions.mjs',
  'src/content/expanded-questions.mjs',
  'src/content/questions.mjs',
  'src/content/trends.mjs',
  'src/race/catalog.mjs',
  'src/race/scoring.mjs',
  'src/race/seed.mjs',
  'src/game.mjs',
  'src/server.mjs',
  'src/public/play.js',
  'src/public/screen.js',
  'tools/booth.mjs',
  'tools/ui-check.mjs',
  'tests/live-contract.mjs',
];

for (const file of syntaxTargets) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const testFiles = readdirSync(new URL('../tests/', import.meta.url))
  .filter((file) => file.endsWith('.test.mjs'))
  .sort()
  .map((file) => `tests/${file}`);
const tests = spawnSync(process.execPath, ['--test', ...testFiles], {
  cwd: root,
  stdio: 'inherit',
});
if (tests.status !== 0) process.exit(tests.status ?? 1);

const ui = spawnSync(process.execPath, ['tools/ui-check.mjs'], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(ui.status ?? 1);
