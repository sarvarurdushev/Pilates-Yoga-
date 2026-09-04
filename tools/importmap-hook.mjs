/**
 * Resolve the anatomy project's bare specifiers the way its browser does.
 *
 * That project has no `node_modules`: `index.html` carries an import map
 * pointing `three` at a vendored copy, which the browser honours and Node does
 * not. This hook reads the same map out of the same HTML, so a checker running
 * in a terminal resolves exactly what a page would. Reading the map rather than
 * hardcoding a path means a change to the vendored version does not need a
 * matching change here.
 *
 * Registered by `tools/check_viewer.mjs`. Read-only, like everything this side
 * does to that project.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';

let imports = {};

export function initialize(repo) {
  const html = readFileSync(resolvePath(repo, 'index.html'), 'utf8');
  const match = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  if (!match) return;
  const map = JSON.parse(match[1]).imports ?? {};
  for (const [key, target] of Object.entries(map)) {
    const url = pathToFileURL(resolvePath(repo, target)).href;
    // A prefix entry must stay a prefix: resolvePath drops the trailing slash
    // and "three/addons/GLTFLoader.js" then lands on "vendor/addonsGLTF...".
    imports[key] = target.endsWith('/') ? `${url}/` : url;
  }
}

export async function resolve(specifier, context, next) {
  if (imports[specifier]) {
    return { url: imports[specifier], shortCircuit: true };
  }
  // Trailing-slash entries are prefixes, e.g. "three/addons/" -> vendor/addons/
  for (const [key, target] of Object.entries(imports)) {
    if (key.endsWith('/') && specifier.startsWith(key)) {
      return { url: target + specifier.slice(key.length), shortCircuit: true };
    }
  }
  return next(specifier, context);
}
