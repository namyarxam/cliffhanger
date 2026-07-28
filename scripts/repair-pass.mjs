#!/usr/bin/env node
/**
 * Full repair pass: for every SHIPPING show that still has high-severity
 * CONTENT flags, run repair-flags --high-only then re-audit, worst-first.
 *
 * Why standalone rather than the batch's audit/repair loop: this operates on
 * spines that already exist and are already audited, and it must be resumable
 * across usage-limit windows. Per-show (repair --slug, then audit --slug, which
 * always runs) sidesteps the audit resume-skip that would otherwise refuse to
 * re-audit a show whose spine we just rewrote.
 *
 * CONTENT flags only — portrait flags (a character card with no matchable cast
 * image) are a different problem repair cannot fix, so they neither select a
 * show for repair nor count against it here.
 *
 * Bounded: at most MAX_ROUNDS repair rounds per show, tracked in a state file,
 * so a show whose flags will not clear (real ungrounded claims, or audit noise
 * that keeps flagging) becomes STUCK for manual review instead of looping.
 *
 * Resumable + polite to the cap: a repair or audit child that dies on the usage
 * limit (empty/"exited N") stops the whole pass cleanly; nothing half-written,
 * every completed show already saved.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'src/recap/data');
const STATE = resolve(ROOT, 'src/recap/data/_repair-state.json');
const MAX_ROUNDS = 2;

const manifest = new Set(
  JSON.parse(readFileSync(resolve(ROOT, 'scripts/batch-manifest.json'), 'utf8')).shows.map(s => s.slug),
);

const contentHigh = slug => {
  try {
    const a = JSON.parse(readFileSync(resolve(DATA, `${slug}.audit.json`), 'utf8'));
    if ((a.results ?? []).some(r => r.error)) return -1; // incomplete audit — leave it
    let h = 0;
    for (const r of a.results) for (const f of r.flags ?? []) if (f.severity === 'high') h++;
    return h;
  } catch {
    return -1;
  }
};

const loadState = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {});
const saveState = s => writeFileSync(STATE, JSON.stringify(s, null, 2));

/** Run a child; resolve {ok, out}. */
function run(script, args) {
  return new Promise(res => {
    const c = spawn('node', [resolve(ROOT, 'scripts', script), ...args], { cwd: ROOT });
    let out = '';
    c.stdout.on('data', d => (out += d));
    c.stderr.on('data', d => (out += d));
    c.on('close', code => res({ ok: code === 0, out }));
    c.on('error', () => res({ ok: false, out }));
  });
}

// The child scripts exit 0 even when every underlying `claude` call rate-limits
// (they catch per-item errors and write them). Exit code is therefore useless
// for detecting the cap — the first repair pass marched through 158 shows on an
// empty quota because of exactly this, overwriting good audits with errored
// ones. So the cap is detected two ways, and either one halts the whole pass:
//   1. the child's own output carries the "claude exited N" signature, or
//   2. the re-audit came back errored (contentHigh === -1).
const isRateLimited = out => /claude exited \d+/.test(out) || /\bexited \d+:/.test(out);

async function main() {
  const state = loadState();

  // Worklist: shipping shows with content-high > 0 and rounds left, worst-first.
  const work = readdirSync(DATA)
    .filter(f => f.endsWith('.audit.json'))
    .map(f => f.replace('.audit.json', ''))
    .filter(slug => manifest.has(slug))
    .map(slug => ({ slug, high: contentHigh(slug), rounds: state[slug]?.rounds ?? 0 }))
    .filter(w => w.high > 0 && w.rounds < MAX_ROUNDS)
    .sort((a, b) => b.high - a.high);

  console.log(`\nrepair pass: ${work.length} shows with content-high flags and rounds left\n`);
  let repaired = 0,
    cleared = 0;

  for (const w of work) {
    const before = w.high;
    process.stdout.write(`  ${w.slug.padEnd(28)} ${before} high (round ${w.rounds + 1}) … `);

    const rep = await run('repair-flags.mjs', ['--slug', w.slug, '--high-only']);
    if (isRateLimited(rep.out)) {
      console.log('rate limit (repair) — stopping cleanly, nothing recorded');
      break;
    }
    if (!rep.ok) {
      console.log('repair failed, skipping');
      continue;
    }

    const aud = await run('audit-spine.mjs', ['--slug', w.slug]);
    // Two independent cap signals — either halts before we record or overwrite.
    const after = contentHigh(w.slug);
    if (isRateLimited(aud.out) || after === -1) {
      console.log('rate limit (re-audit) — stopping cleanly, nothing recorded');
      break;
    }

    state[w.slug] = { rounds: w.rounds + 1, high: after };
    saveState(state);
    repaired++;
    if (after === 0) cleared++;
    console.log(`-> ${after} high${after === 0 ? '  ✅ clean' : ''}`);
  }

  console.log(`\ndone this window: ${repaired} repaired, ${cleared} reached clean\n`);
}

main().catch(e => {
  console.error(`\n✗ ${e.message}\n`);
  process.exit(1);
});
