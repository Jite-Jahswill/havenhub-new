// Copies MapLibre's web worker (and the shared chunk it imports) into
// public/vendor so the browser can load it. Bundlers rewrite MapLibre's own
// file location, so its default "sibling file" worker URL does not exist.
// Runs before `dev` and `build`; the output is gitignored.
import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dist = join(dirname(require.resolve('maplibre-gl/package.json')), 'dist');
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'vendor', 'maplibre');

await mkdir(target, { recursive: true });
for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  await copyFile(join(dist, file), join(target, file));
}
