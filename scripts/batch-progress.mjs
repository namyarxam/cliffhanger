#!/usr/bin/env node
// One-line aggregate of batch progress. Reads the checkpoint, no side effects.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const R = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const s = JSON.parse(readFileSync(resolve(R, 'src/recap/data/_batch-state.json'))).shows;
const man = JSON.parse(readFileSync(resolve(R, 'scripts/batch-manifest.json'))).shows;
let clean = 0, stuck = 0, rej = 0, spine = 0, pending = 0;
for (const { slug } of man) {
  const e = s[slug];
  if (!e) { pending++; continue; }
  if (e.spine === true) spine++;
  if (e.eligible && e.eligible.ok === false) rej++;
  if (e.quality === 'clean') clean++;
  else if (e.quality === 'stuck') stuck++;
  else if (!(e.eligible && e.eligible.ok === false)) pending++;
}
console.log(`${man.length} total | ${clean} CLEAN + ${stuck} STUCK = ${clean + stuck} finished | ${spine} spines | ${rej} rejected (pre-fix, will shrink) | ${pending} pending`);
