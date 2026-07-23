#!/usr/bin/env node
/**
 * Resumable batch runner for the recap pipeline.
 *
 * Generation runs through the `claude` CLI on a subscription with rolling
 * usage limits, so a long run WILL be interrupted — that is the normal case,
 * not the failure case. Everything here is built around resuming: progress is
 * checkpointed per show per stage, hitting a limit exits cleanly rather than
 * crashing mid-show, and re-running picks up exactly where it stopped.
 *
 * Stages, in order:
 *   fetch    TVMaze + TMDB + Wikipedia  -> <slug>.json          (cheap, HTTP only)
 *   eligible structural verdict         -> checkpoint            (free, local)
 *   spine    claude -p                  -> <slug>.spine.json     (EXPENSIVE)
 *   inspect  QA gate                    -> checkpoint            (free, local)
 *
 * Upload is deliberately NOT a stage. A human reads two seasons per show
 * before anything ships, and wiring upload into the same loop would make it
 * far too easy to skip that.
 *
 * The stage order is not arbitrary: fetch and eligibility are both cheap and
 * both able to reject a show, so a show that should not have a recap costs no
 * generation call at all.
 *
 * Usage:
 *   node scripts/batch-recaps.mjs --manifest scripts/validation-set.json
 *   node scripts/batch-recaps.mjs --manifest ... --stage fetch     # fetch+eligibility only
 *   node scripts/batch-recaps.mjs --manifest ... --limit 5         # bound one run
 *   node scripts/batch-recaps.mjs --manifest ... --only severance
 *   node scripts/batch-recaps.mjs --manifest ... --report          # print state, run nothing
 */

import { readFile, writeFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate } from './eligibility.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'src/recap/data');
const STATE = resolve(DATA, '_batch-state.json');

const arg = (flag, fallback = null) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const has = flag => process.argv.includes(flag);

// ---------------------------------------------------------------- state

async function loadState() {
  try {
    return JSON.parse(await readFile(STATE, 'utf8'));
  } catch {
    return { shows: {} };
  }
}

async function saveState(state) {
  await writeFile(STATE, JSON.stringify(state, null, 2));
}

const entryFor = (state, slug) =>
  (state.shows[slug] ??= { fetch: null, eligible: null, spine: null, inspect: null, errors: [] });

// ---------------------------------------------------------------- run

/**
 * Run a pipeline script as a child process.
 *
 * Output is captured rather than inherited so a usage limit can be detected
 * in the text — the CLI does not signal it distinctly enough in the exit code
 * to rely on that alone.
 */
function run(script, args) {
  return new Promise(res => {
    const child = spawn('node', [resolve(ROOT, 'scripts', script), ...args], { cwd: ROOT });
    let out = '';
    let err = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('error', e => res({ code: 1, out, err: String(e.message) }));
    child.on('close', code => res({ code, out, err }));
  });
}

/**
 * Did this failure mean "out of quota" rather than "this show is broken"?
 *
 * The distinction decides whether to stop the whole run or skip one show.
 * Guessing wrong in the skip direction burns through the manifest marking
 * every remaining show as failed, so this errs toward stopping.
 */
function isRateLimited(text) {
  return /usage limit|rate limit|quota|too many requests|resets at|429/i.test(text);
}

const exists = async p => access(p).then(() => true).catch(() => false);

// ---------------------------------------------------------------- report

function printReport(manifest, state) {
  const rows = manifest.shows.map(s => {
    const e = state.shows[s.slug] ?? {};
    const mark = v => (v === true ? '✓' : v === false ? '✗' : v ? '✓' : '·');
    return {
      slug: s.slug,
      probe: s.probe,
      fetch: mark(e.fetch),
      eligible: e.eligible === null || e.eligible === undefined ? '·' : e.eligible.ok ? '✓' : 'REJECT',
      spine: mark(e.spine),
      inspect: mark(e.inspect),
      note: e.eligible && !e.eligible.ok ? e.eligible.reasons[0] : (e.errors?.[e.errors.length - 1] ?? ''),
    };
  });

  console.log('\n  slug                probe        fetch elig    spine insp  note');
  console.log('  ' + '─'.repeat(96));
  for (const r of rows) {
    console.log(
      `  ${r.slug.padEnd(19)}${r.probe.padEnd(13)}${r.fetch.padEnd(6)}${r.eligible.padEnd(8)}` +
        `${r.spine.padEnd(6)}${r.inspect.padEnd(6)}${r.note.slice(0, 44)}`,
    );
  }

  const done = rows.filter(r => r.inspect === '✓').length;
  const rejected = rows.filter(r => r.eligible === 'REJECT').length;
  console.log(`\n  ${done} complete · ${rejected} rejected · ${rows.length - done - rejected} outstanding\n`);
}

// ---------------------------------------------------------------- main

async function main() {
  const manifestPath = arg('--manifest', 'scripts/validation-set.json');
  const manifest = JSON.parse(await readFile(resolve(ROOT, manifestPath), 'utf8'));
  const state = await loadState();

  const only = arg('--only');
  const stageStop = arg('--stage');
  const limit = Number(arg('--limit', '0')) || Infinity;

  if (has('--report')) {
    printReport(manifest, state);
    return;
  }

  let worked = 0;

  for (const show of manifest.shows) {
    if (only && show.slug !== only) continue;
    if (worked >= limit) {
      console.log(`\n▪ stopping: --limit ${limit} reached. Re-run to continue.\n`);
      break;
    }

    const e = entryFor(state, show.slug);
    const dataPath = resolve(DATA, `${show.slug}.json`);
    const spinePath = resolve(DATA, `${show.slug}.spine.json`);

    // ---- fetch ----------------------------------------------------------
    if (!e.fetch || !(await exists(dataPath))) {
      console.log(`\n▸ ${show.slug} — fetch (${show.probe}: ${show.why})`);
      const r = await run('fetch-recap.mjs', [
        '--show', show.show,
        '--slug', show.slug,
        '--through', String(show.through ?? 'all'),
      ]);
      if (r.code !== 0) {
        const msg = (r.err || r.out).trim().split('\n').pop() ?? 'fetch failed';
        console.log(`  ✗ fetch failed: ${msg.slice(0, 160)}`);
        e.fetch = false;
        e.errors.push(`fetch: ${msg.slice(0, 200)}`);
        await saveState(state);
        continue;
      }
      e.fetch = true;
      await saveState(state);
    }

    // ---- eligibility ----------------------------------------------------
    //
    // Always recomputed. It is free, and the rules change more often than the
    // data does, so a cached verdict would go stale silently.
    const data = JSON.parse(await readFile(dataPath, 'utf8'));
    const verdict = evaluate(data);
    e.eligible = verdict;
    await saveState(state);

    const { stats } = verdict;
    console.log(
      `\n▸ ${show.slug} — ${stats.seasons} seasons, ${stats.totalEpisodes} eps, ` +
        `coverage ${Math.round(stats.coverage * 100)}%, cast continuity ${Math.round(stats.continuity * 100)}%`,
    );
    for (const w of verdict.warnings) console.log(`  ⚠ ${w}`);
    if (!verdict.ok) {
      for (const reason of verdict.reasons) console.log(`  ✗ REJECTED: ${reason}`);
      continue;
    }

    if (stageStop === 'fetch') continue;

    // ---- spine ----------------------------------------------------------
    if (!e.spine || !(await exists(spinePath))) {
      console.log(`  … generating spine (1 call)`);
      const r = await run('generate-spine.mjs', ['--slug', show.slug, '--whole-show']);
      const text = r.out + r.err;
      if (r.code !== 0) {
        if (isRateLimited(text)) {
          console.log('\n▪ usage limit reached — stopping cleanly. Re-run later to resume.\n');
          await saveState(state);
          printReport(manifest, state);
          return;
        }
        const msg = text.trim().split('\n').pop() ?? 'spine failed';
        console.log(`  ✗ spine failed: ${msg.slice(0, 160)}`);
        e.spine = false;
        e.errors.push(`spine: ${msg.slice(0, 200)}`);
        await saveState(state);
        continue;
      }
      e.spine = true;
      worked++;
      await saveState(state);
    }

    if (stageStop === 'spine') continue;

    // ---- inspect --------------------------------------------------------
    const r = await run('inspect-spine.mjs', ['--slug', show.slug]);
    // Printed in full: this is the QA gate, and a summary would hide exactly
    // the warnings it exists to surface.
    console.log(r.out.replace(/^/gm, '  '));
    e.inspect = r.code === 0;
    await saveState(state);
  }

  printReport(manifest, state);
}

main().catch(err => {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
});
