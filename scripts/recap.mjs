#!/usr/bin/env node
/**
 * Recap pipeline — one command per operation, one process per run.
 *
 * The 29-script predecessor died of its own seams: stages passed files to each
 * other, and three separate bugs silently dropped 145 seasons across 66 shows
 * with every stage reporting success. Here each phase hands the next an
 * in-memory object, the artifacts in scripts/recap-work/ are debug output and
 * the review handoff — never a stage interface — and a run that writes the
 * database ends by reading it back and asserting what it holds.
 *
 * Commands:
 *   node scripts/recap.mjs add --show "Severance" [--slug severance] [--upload] [--model m]
 *       New show: fetch → eligibility → generate (1 call) → verify+repair →
 *       compose → contact sheet. Uploads only with --upload; otherwise review
 *       the sheet, then `ship`.
 *
 *   node scripts/recap.mjs extend --slug severance [--show "Severance"] [--upload] [--model m]
 *       A new season aired: generates ONLY the seasons the database lacks,
 *       per-season with prior context, never touching shipped text.
 *
 *   node scripts/recap.mjs ship --slug severance
 *       Upload the reviewed artifacts from a previous add/extend. 0 model
 *       calls. Refuses if the audit left high-severity flags.
 *
 *   node scripts/recap.mjs status [--slug severance]
 *       What the live database holds (and, with --slug, vs TVMaze's aired
 *       seasons).
 *
 * Model calls run through the `claude` CLI on the subscription — see
 * recap-lib/model.mjs. Verification verdicts are content-hash cached, so
 * re-running a command re-verifies nothing whose text didn't change.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { WORK, loadEnv } from './recap-lib/env.mjs';
import { fetchShow } from './recap-lib/fetch.mjs';
import { evaluate } from './recap-lib/eligibility.mjs';
import { generateSpine } from './recap-lib/spine.mjs';
import { verifyAndRepair } from './recap-lib/verify.mjs';
import { composeShow, reportComposition, loadCastImages } from './recap-lib/compose.mjs';
import { makeDb, existingSeasons, uploadShow, assertShipped } from './recap-lib/upload.mjs';
import { writeContactSheet } from './recap-lib/contact-sheet.mjs';
import { buildQueue, printQueue } from './recap-lib/queue.mjs';
import { notifyRequesters, declineShow } from './recap-lib/notify.mjs';

// ---------------------------------------------------------------- cli

const argv = process.argv.slice(2);
const command = argv[0];
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const flag = name => argv.includes(`--${name}`);

const slugify = s =>
  s
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// ---------------------------------------------------------------- artifacts

const spinePath = slug => resolve(WORK, `${slug}.spine.json`);
const verifyPath = slug => resolve(WORK, `${slug}.verify.json`);
const dataPath = slug => resolve(WORK, `${slug}.json`);

async function readArtifact(path, what) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error(`missing ${what} at ${path} — run add/extend first`);
  }
}

async function saveArtifacts(slug, spine, report) {
  await mkdir(WORK, { recursive: true });
  await writeFile(spinePath(slug), JSON.stringify(spine, null, 2));
  await writeFile(verifyPath(slug), JSON.stringify(report, null, 2));
}

// ---------------------------------------------------------------- phases

function gateEligibility(data) {
  const verdict = evaluate(data);
  for (const w of verdict.warnings) console.log(`  · ${w}`);
  if (!verdict.ok) {
    const why = verdict.reasons.map(r => `  ✗ ${r}`).join('\n');
    throw new Error(`"${data.title}" is not eligible for a recap:\n${why}`);
  }
  console.log(`  ✓ eligible — generating through S${verdict.generateThrough}`);
  return verdict;
}

async function composeAndSheet(data, spine, report) {
  const overrides = await loadCastImages();
  const { show, seasons } = composeShow(data, spine.seasons, {
    imageOverrides: overrides[data.slug] ?? {},
    castLinks: spine.castLinks ?? {},
    throughSeason: spine.throughSeason ?? null,
  });
  reportComposition(show, seasons);
  const sheet = await writeContactSheet(show, seasons, report);
  console.log(`\n  contact sheet: ${sheet}`);
  console.log('  open it and check: every face matches its name, every still belongs to its beat.');
  return { show, seasons };
}

async function doUpload(env, show, seasons) {
  const db = makeDb(env);
  await uploadShow(db, show, seasons);
  await assertShipped(db, show.slug, seasons.map(s => s.season));
  // Only after the write is PROVEN — a push about a recap that didn't land
  // would be worse than no push.
  await notifyRequesters(db, env, show);
}

function requireCleanAudit(report) {
  const dirty = Object.entries(report)
    .filter(([, r]) => (r.flags ?? []).some(f => f.severity === 'high'))
    .map(([n]) => `S${n}`);
  if (dirty.length) {
    throw new Error(
      `audit left high-severity flags on ${dirty.join(', ')} — refusing to ship. ` +
        `Accuracy-first: fix the source or hand-edit the spine in ${WORK}, then re-run.`,
    );
  }
}

// ---------------------------------------------------------------- commands

async function add() {
  const showName = arg('show');
  if (!showName) throw new Error('add needs --show "Title"');
  const slug = arg('slug', slugify(showName));
  const model = arg('model');
  const env = await loadEnv();

  // A show already in the library is an extend, not an add — the paths differ
  // in what they are allowed to rewrite.
  const db = makeDb(env);
  const existing = await existingSeasons(db, slug);
  if (existing) {
    throw new Error(
      `"${slug}" is already live (through S${existing.show.through_season}). Use: node scripts/recap.mjs extend --slug ${slug}`,
    );
  }

  const data = await fetchShow({ showName, slug, through: 'all' }, env);
  const verdict = gateEligibility(data);

  const targets = data.seasons.filter(s => s.season <= verdict.generateThrough);
  console.log('');
  const generated = await generateSpine({ data, targets, wholeShow: true, model });

  console.log('\n▸ Verifying against source');
  const { seasons: verified, report, ok } = await verifyAndRepair(data, generated, { model });

  const spine = { slug, generatedFor: data.title, throughSeason: verdict.generateThrough, seasons: verified };
  await saveArtifacts(slug, spine, report);

  const { show, seasons } = await composeAndSheet(data, spine, report);

  if (!ok) {
    throw new Error(
      `not shippable — high-severity audit flags remain (see the sheet). Nothing was uploaded.`,
    );
  }
  if (flag('upload')) {
    await doUpload(env, show, seasons);
  } else {
    console.log(`\n  when the sheet looks right:  node scripts/recap.mjs ship --slug ${slug}\n`);
  }
}

async function extend() {
  const slug = arg('slug');
  if (!slug) throw new Error('extend needs --slug <slug>');
  const model = arg('model');
  const env = await loadEnv();

  const db = makeDb(env);
  const existing = await existingSeasons(db, slug);
  if (!existing) {
    throw new Error(`"${slug}" is not in the library. Use: node scripts/recap.mjs add --show "Title"`);
  }
  const haveThrough = Math.max(existing.show.through_season, ...existing.seasons, 0);
  console.log(`\n▸ ${slug}: database holds S1-S${haveThrough}`);

  // The title to search by: passed, or recovered from the fetch artifact of a
  // previous run, or derived from the slug as a last resort.
  const showName =
    arg('show') ??
    (await readFile(dataPath(slug), 'utf8')
      .then(t => JSON.parse(t).title)
      .catch(() => slug.replace(/-/g, ' ')));

  const data = await fetchShow({ showName, slug, through: 'all' }, env);
  const verdict = gateEligibility(data);

  if (verdict.generateThrough <= haveThrough) {
    console.log(
      `\n  nothing to add: generation is bounded to S${verdict.generateThrough} ` +
        `(usually Wikipedia lagging the newest season) and the library already holds S${haveThrough}.\n`,
    );
    return;
  }

  const targets = data.seasons.filter(s => s.season > haveThrough && s.season <= verdict.generateThrough);
  console.log(`  new season(s): S${targets.map(s => s.season).join(', S')}\n`);

  // Per-season with prior context: shipped seasons are never re-asked for, so
  // reviewed text cannot be rewritten by an extension.
  const generated = await generateSpine({ data, targets, wholeShow: false, model });

  console.log('\n▸ Verifying against source');
  const { seasons: verified, report, ok } = await verifyAndRepair(data, generated, { model });

  const spine = {
    slug,
    generatedFor: data.title,
    throughSeason: Math.max(haveThrough, verdict.generateThrough),
    seasons: verified,
  };
  await saveArtifacts(slug, spine, report);

  const { show, seasons } = await composeAndSheet(data, spine, report);

  if (!ok) {
    throw new Error(`not shippable — high-severity audit flags remain. Nothing was uploaded.`);
  }
  if (flag('upload')) {
    await doUpload(env, show, seasons);
  } else {
    console.log(`\n  when the sheet looks right:  node scripts/recap.mjs ship --slug ${slug}\n`);
  }
}

async function ship() {
  const slug = arg('slug');
  if (!slug) throw new Error('ship needs --slug <slug>');
  const env = await loadEnv();

  const data = await readArtifact(dataPath(slug), 'fetch dataset');
  const spine = await readArtifact(spinePath(slug), 'spine');
  const report = await readArtifact(verifyPath(slug), 'verify report');

  requireCleanAudit(report);
  // Eligibility re-checked at the last possible moment, not trusted from the
  // generation run — the rules have changed under a spine before.
  gateEligibility(data);

  const overrides = await loadCastImages();
  const { show, seasons } = composeShow(data, spine.seasons, {
    imageOverrides: overrides[slug] ?? {},
    castLinks: spine.castLinks ?? {},
    throughSeason: spine.throughSeason ?? null,
  });
  reportComposition(show, seasons);
  await doUpload(env, show, seasons);
}

async function status() {
  const env = await loadEnv();
  const db = makeDb(env);
  const slug = arg('slug');

  if (slug) {
    const existing = await existingSeasons(db, slug);
    if (!existing) {
      console.log(`\n  "${slug}" is not in the library\n`);
      return;
    }
    console.log(
      `\n  ${slug}: through S${existing.show.through_season} of ${existing.show.total_seasons ?? '?'} · rows for S${existing.seasons.join(', S')} · generated ${existing.show.generated_at}\n`,
    );
    return;
  }

  const { data: shows, error } = await db
    .from('recap_shows')
    .select('slug, through_season, total_seasons')
    .order('slug');
  if (error) throw new Error(error.message);
  const behind = shows.filter(s => s.total_seasons && s.through_season < s.total_seasons);
  console.log(`\n  library: ${shows.length} shows`);
  if (behind.length) {
    console.log(`  behind TVMaze's season count (candidates for extend):`);
    for (const s of behind) console.log(`    ${s.slug.padEnd(36)} S${s.through_season} of ${s.total_seasons}`);
  }
  console.log('');
}

async function queue() {
  const env = await loadEnv();
  const db = makeDb(env);
  console.log('\n▸ Building the queue (all free — TVMaze + Wikipedia + database reads)');
  const result = await buildQueue(db, { probe: !flag('no-probe') });
  if (flag('json')) {
    console.log(JSON.stringify(result.stale, null, 2));
    return;
  }
  printQueue(result);
}

async function decline() {
  const showId = arg('show-id');
  const title = arg('title');
  const publicReason = arg('public');
  if (!showId || !title || !publicReason) {
    throw new Error(
      'decline needs --show-id <tvmaze id> --title "Show" --public "sentence the app shows" [--reason "internal note"]',
    );
  }
  const env = await loadEnv();
  await declineShow(makeDb(env), {
    showId,
    title,
    reason: arg('reason', publicReason),
    publicReason,
  });
}

// ---------------------------------------------------------------- main

const commands = { add, extend, ship, status, queue, decline };
const run = commands[command];
if (!run) {
  console.error(`\nusage: node scripts/recap.mjs <add|extend|ship|status|queue> [options]\n`);
  process.exit(1);
}
run().catch(err => {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
});
