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
  (state.shows[slug] ??= {
    fetch: null,
    eligible: null,
    spine: null,
    inspect: null,
    link: null,
    // 'clean' (0 high-severity flags), 'stuck' (high flags survived the repair
    // cap), or null (not yet audited). This is the gate that decides whether a
    // show is worth a human's review time.
    quality: null,
    auditRounds: [],
    errors: [],
  });

/**
 * Audit → repair → re-audit, until no high-severity flag survives or the cap
 * is hit.
 *
 * A loop rather than a single pass because a single pass demonstrably misses
 * things: on Better Call Saul the first audit caught the wrong character
 * planting a battery, and only the re-audit AFTER repair caught that the
 * battery's owner was also wrong, in the same sentence. Each repair changes
 * the text the next audit reads, so a second look is a genuinely different
 * look, not a retry.
 *
 * High-severity only. A high flag is "a viewer would come away believing
 * something false"; a low flag is imprecision. Chasing lows to zero would
 * spend calls fighting the auditor's own strictness and never converge.
 */
const MAX_REPAIR_ROUNDS = 3;

/** How many high-severity flags the latest audit recorded. */
async function countHigh(slug) {
  try {
    const a = JSON.parse(await readFile(resolve(DATA, `${slug}.audit.json`), 'utf8'));
    return a.results.reduce(
      (n, r) => n + (r.flags ?? []).filter(f => f.severity === 'high').length,
      0,
    );
  } catch {
    return null; // no audit on disk
  }
}

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
    // Quality is the headline once a show reaches it: CLEAN means audited to
    // zero high-severity flags and ready for a human read; STUCK means a flag
    // survived the repair cap and needs hand attention. The rounds trail shows
    // the repair working (e.g. 6→2→0).
    const quality =
      e.quality === 'clean' ? 'CLEAN'
      : e.quality === 'stuck' ? 'STUCK'
      : '·';
    return {
      slug: s.slug,
      fetch: mark(e.fetch),
      eligible: e.eligible == null ? '·' : e.eligible.ok ? '✓' : 'REJECT',
      spine: mark(e.spine),
      link: mark(e.link),
      quality,
      rounds: e.auditRounds?.length ? e.auditRounds.join('→') : '',
      note:
        e.eligible && !e.eligible.ok
          ? e.eligible.reasons[0]
          : e.quality === 'stuck'
            ? `${e.auditRounds?.[e.auditRounds.length - 1]} high survived`
            : (e.errors?.[e.errors.length - 1] ?? ''),
    };
  });

  console.log('\n  slug                fetch elig    spine link  quality  rounds  note');
  console.log('  ' + '─'.repeat(100));
  for (const r of rows) {
    console.log(
      `  ${r.slug.padEnd(19)}${r.fetch.padEnd(6)}${r.eligible.padEnd(8)}` +
        `${r.spine.padEnd(6)}${r.link.padEnd(6)}${r.quality.padEnd(9)}${(r.rounds || '').padEnd(8)}${r.note.slice(0, 34)}`,
    );
  }

  const clean = rows.filter(r => r.quality === 'CLEAN').length;
  const stuck = rows.filter(r => r.quality === 'STUCK').length;
  const rejected = rows.filter(r => r.eligible === 'REJECT').length;
  const outstanding = rows.length - clean - stuck - rejected;
  console.log(
    `\n  ${clean} clean · ${stuck} stuck · ${rejected} rejected · ${outstanding} outstanding\n`,
  );
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
      `\n▸ ${show.slug} — ${stats.seasons} seasons fetched, usable S1-S${verdict.usableThrough} ` +
        `(${stats.usableEpisodes} eps), coverage ${Math.round(stats.coverage * 100)}%, ` +
        `cast continuity ${Math.round(stats.continuity * 100)}%`,
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
      const r = await run('generate-spine.mjs', [
        '--slug', show.slug,
        '--whole-show',
        // Never generate past what eligibility judged writable — the seasons
        // beyond it are the ones Wikipedia has not caught up on.
        '--through', String(verdict.usableThrough),
      ]);
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
    const insp = await run('inspect-spine.mjs', ['--slug', show.slug]);
    // Printed in full: this is the QA gate, and a summary would hide exactly
    // the warnings it exists to surface.
    console.log(insp.out.replace(/^/gm, '  '));
    e.inspect = insp.code === 0;
    await saveState(state);

    if (stageStop === 'inspect') continue;

    // ---- link cast ------------------------------------------------------
    // Character cards to cast photos, resolving aliases no string match can
    // reach. Before the audit because a repaired character line can change the
    // name a card carries, and the link is keyed on that name.
    if (!e.link) {
      const lk = run('link-cast.mjs', ['--slug', show.slug]);
      const r = await lk;
      if (r.code !== 0 && isRateLimited(r.out + r.err)) {
        console.log('\n▪ usage limit reached — stopping cleanly. Re-run later to resume.\n');
        await saveState(state);
        printReport(manifest, state);
        return;
      }
      e.link = r.code === 0;
      if (r.code !== 0) e.errors.push(`link: ${(r.out + r.err).trim().split('\n').pop()?.slice(0, 160)}`);
      await saveState(state);
    }

    if (stageStop === 'link') continue;

    // ---- audit → repair → re-audit --------------------------------------
    //
    // The truth gate. Everything above verifies shape; this checks the spine
    // against the source it was generated from and rewrites what does not hold.
    // Resumable by construction: the spine and audit files on disk ARE the
    // state, so a run interrupted mid-loop re-enters here and re-audits the
    // current spine, which is idempotent.
    if (e.quality !== 'clean') {
      e.auditRounds = [];
      let stopped = false;
      for (let round = 1; round <= MAX_REPAIR_ROUNDS; round++) {
        const au = await run('audit-spine.mjs', ['--slug', show.slug]);
        if (au.code !== 0 && isRateLimited(au.out + au.err)) {
          stopped = true;
          break;
        }
        const high = await countHigh(show.slug);
        e.auditRounds.push(high ?? -1);
        console.log(`  audit round ${round}: ${high ?? '?'} high-severity`);
        await saveState(state);

        if (high === 0) break;
        if (round === MAX_REPAIR_ROUNDS) break; // leave STUCK, don't repair into a wall

        const rp = await run('repair-flags.mjs', ['--slug', show.slug, '--high-only']);
        if (rp.code !== 0 && isRateLimited(rp.out + rp.err)) {
          stopped = true;
          break;
        }
        console.log(rp.out.replace(/^/gm, '  '));
      }

      if (stopped) {
        console.log('\n▪ usage limit reached mid-audit — stopping cleanly. Re-run to resume.\n');
        await saveState(state);
        printReport(manifest, state);
        return;
      }

      const finalHigh = e.auditRounds[e.auditRounds.length - 1] ?? -1;
      e.quality = finalHigh === 0 ? 'clean' : 'stuck';
      console.log(`  ▸ ${show.slug}: ${e.quality.toUpperCase()}${e.quality === 'stuck' ? ` (${finalHigh} high-severity survived ${MAX_REPAIR_ROUNDS} rounds)` : ''}`);
      await saveState(state);
    }
  }

  printReport(manifest, state);
}

main().catch(err => {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
});
