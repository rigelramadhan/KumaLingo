// Run only when explicitly preparing a deployment. Browser identifiers become public.
// Backend secrets must remain in Worker bindings and never enter this file.
import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateRuntimeConfig } from '../webBridge/src/config.mjs';

const root = resolve(import.meta.dirname, '..');
const directory = resolve(root, 'composeApp/build/dist/wasmJs/productionExecutable');
if (!(await stat(resolve(directory, 'index.html'))).isFile()) throw new Error('Build the web application first.');
const input = JSON.parse(await readFile(resolve(root, '.secrets/web-runtime.json'), 'utf8'));
const config = validateRuntimeConfig(input, { allowLocal: false });
await writeFile(resolve(directory, 'config.json'), JSON.stringify(config));
console.log('Prepared browser-visible Firebase/OAuth configuration in the ignored build directory. No values displayed.');
