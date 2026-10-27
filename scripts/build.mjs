// SPDX-License-Identifier: Apache-2.0
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
for (const name of ['@cline/core', '@cline/sdk']) {
  const dependency = JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8'));
  if (dependency.version !== manifest.peerDependencies[name] || manifest.dependencies[name]) {
    throw new Error(
      `Build requires the declared peer version of ${name}, without a runtime dependency copy.`,
    );
  }
}
// dist is generated; stale files must never enter the next pinned archive.
rmSync(join(root, 'dist'), { recursive: true, force: true });
const declarations = Bun.spawnSync(['bun', 'tsc', '--emitDeclarationOnly'], {
  cwd: root,
  stdout: 'inherit',
  stderr: 'inherit',
});
if (declarations.exitCode !== 0) process.exit(declarations.exitCode || 1);
const result = await Bun.build({
  entrypoints: [join(root, 'src/index.ts'), join(root, 'src/host.ts')],
  outdir: join(root, 'dist'),
  target: 'node',
  format: 'esm',
  external: ['@cline/core', '@cline/sdk'],
  sourcemap: 'none',
  minify: false,
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log('Built V2 runtime bundle; SDK peers remain host-owned.');
