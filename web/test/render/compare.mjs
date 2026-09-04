/**
 * Compares two capture directories written by capture.mjs.
 *
 * The point of this is §12 step 1 of the project brief: the palette-texture rewrite of
 * brainMaterial.js has to render the existing brain identically, not merely similarly.
 * "Looks the same" is not a claim anyone can check later; a byte count is.
 *
 * Usage: node test/render/compare.mjs <dirA> <dirB> [maxChannelDelta]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [a, b, tolArg] = process.argv.slice(2);
if (!a || !b) { console.error('usage: compare.mjs <dirA> <dirB> [maxChannelDelta]'); process.exit(1); }
const tol = tolArg === undefined ? 0 : +tolArg;

const names = readdirSync(a).filter(f => f.endsWith('.bin')).sort();
if (!names.length) { console.error(`no .bin captures in ${a}`); process.exit(1); }

let worst = 0, failed = 0;
for (const name of names) {
  const A = readFileSync(join(a, name)), B = readFileSync(join(b, name));
  if (A.length !== B.length) {
    console.log(`FAIL ${name}: size ${A.length} vs ${B.length}`); failed++; continue;
  }
  let diffPx = 0, maxD = 0, sumD = 0;
  for (let i = 0; i < A.length; i += 4) {
    let d = 0;
    for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(A[i+c] - B[i+c]));
    if (d) { diffPx++; sumD += d; if (d > maxD) maxD = d; }
  }
  worst = Math.max(worst, maxD);
  const px = A.length / 4;
  const pct = (100 * diffPx / px).toFixed(4);
  const ok = maxD <= tol;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(16)} ` +
              `differing px ${String(diffPx).padStart(7)}/${px} (${pct}%)  ` +
              `max channel delta ${maxD}  mean ${diffPx ? (sumD/diffPx).toFixed(2) : '0.00'}`);
}

console.log(failed
  ? `\n${failed}/${names.length} scenarios exceed tolerance ${tol} (worst delta ${worst})`
  : `\nall ${names.length} scenarios within tolerance ${tol} (worst delta ${worst})`);
process.exit(failed ? 1 : 0);
