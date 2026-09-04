/**
 * Produces a single .html that runs by double-clicking it — no server, no install.
 *
 * A normal ES-module page cannot run from file:// (the browser blocks module and fetch
 * requests on that origin), so everything is bundled to a classic script and the model
 * is embedded as a data URL.
 */
import * as esbuild from 'esbuild';
import fs from 'node:fs';

const glb = fs.readFileSync('models/cortex.glb').toString('base64');
const sub = fs.readFileSync('models/subcortical.glb').toString('base64');
console.log(`cortex ${(glb.length/1e6).toFixed(1)} MB + subcortical ${(sub.length/1e6).toFixed(1)} MB base64`);

const bundle = await esbuild.build({
  entryPoints: ['src/main.js'],
  bundle: true, format: 'iife', minify: true, write: false,
  target: ['chrome100', 'safari15', 'firefox100'],
  define: {
    'MODEL_URL_OVERRIDE':   JSON.stringify('data:model/gltf-binary;base64,' + glb),
    'SUBCORTICAL_OVERRIDE': JSON.stringify('data:model/gltf-binary;base64,' + sub),
  },
});
let js = bundle.outputFiles[0].text;
console.log(`bundle ${(js.length/1e6).toFixed(1)} MB`);

// guard: a literal </script> inside the bundle would end the tag early
js = js.replace(/<\/script/gi, '<\\/script');
// NOTE: the replacement must be a function. Passing the bundle as a string makes
// String.replace expand $& / $1 patterns inside minified code into the matched tag.
let html = fs.readFileSync('index.html', 'utf8')
  .replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '')
  .replace('<script type="module" src="./src/main.js"></script>',
           () => '<script>\n' + js + '\n</script>');
fs.writeFileSync('neurolab-standalone.html', html);
console.log(`wrote neurolab-standalone.html  ${(html.length/1e6).toFixed(1)} MB`);
