#!/usr/bin/env node
/**
 * Check a generated spine against the source it was generated from.
 *
 * WHY THIS EXISTS
 *
 * Every gate before this one verifies SHAPE. inspect-spine checks beat
 * lengths, ordering, character counts, payload size and proper-noun leakage;
 * coherence checks that characters named in beats have cards and vice versa.
 * All of them passed on a Dark Matter spine that described a different series
 * with the same title, and on a House of the Dragon card that credited one
 * character's role to another actor. A correctly shaped lie is invisible to
 * every one of them.
 *
 * The only checks that can close that gap are grounded ones: does the source
 * actually say this. Wikipedia plot summaries are already on disk next to each
 * spine — they are what the generator was grounded on — so the claim and the
 * material it came from can be put side by side without fetching anything.
 *
 * WHAT THIS IS NOT
 *
 * A model auditing a model shares blind spots, and this does not replace a
 * person reading a recap of a show they know. It is aimed at the case a person
 * cannot cover: twenty shows, most of them not fresh in anyone's memory, where
 * a plausible invented detail reads exactly like a remembered one. Checking a
 * sentence against text in front of you is a materially easier task than
 * writing the sentence, which is the same asymmetry that made grounding on
 * Wikipedia the single biggest quality lever in generation.
 *
 * Per season rather than per show: the whole point is that the source sits
 * next to the claim, and a whole-show prompt buries a season's twelve episode
 * summaries among sixty.
 *
 * Usage:
 *   node scripts/audit-spine.mjs --slug andor
 *   node scripts/audit-spine.mjs --slug hotd --season 2
 *   node scripts/audit-spine.mjs --all
 *   node scripts/audit-spine.mjs --all --high-only
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'src/recap/data');

const arg = (flag, fallback = null) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

/**
 * Season audits run concurrently.
 *
 * Generation is one call per show; auditing is one per SEASON, so run
 * sequentially it costs several times generation in wall-clock and reads as
 * the expensive step even though each call is small. Nothing about the work
 * requires order — each season is checked against its own summaries and shares
 * no state with any other — so the sequential version was paying a latency
 * multiple for nothing.
 *
 * Six is a floor on politeness rather than a tuned number: enough to collapse
 * a 75-call sweep into a dozen rounds, low enough not to run a wall of
 * subprocesses at the CLI.
 */
const CONCURRENCY = Number(arg('--concurrency', 6));

/** Run `worker` over `items`, at most `limit` in flight. Order is preserved. */
async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

// A season with almost no source text cannot be audited — every beat would be
// flagged unsupported, which is a statement about our fetch rather than about
// the spine. Skipped and reported rather than silently passed.
const MIN_SOURCED_EPISODES = 0.5;

function askClaude(prompt, model = null) {
  return new Promise((res, rej) => {
    // --tools '' is load-bearing, not tidiness: with tools available the CLI
    // behaves agentically, returns prose, and has claimed to write files it
    // never wrote.
    const args = ['-p', '--tools', ''];
    if (model) args.push('--model', model);
    const child = spawn('claude', args, { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('error', rej);
    child.on('close', c =>
      c === 0 ? res(out) : rej(new Error(`claude exited ${c}: ${err.slice(0, 300)}`)),
    );
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const c = fenced ? fenced[1] : text;
  const a = c.indexOf('{');
  const b = c.lastIndexOf('}');
  if (a === -1) throw new Error(`no JSON in response:\n${text.slice(0, 300)}`);
  return JSON.parse(c.slice(a, b + 1));
}

function buildPrompt(show, seasonNo, episodes, season) {
  const source = episodes
    .map(e => `[S${seasonNo}E${e.episode}] ${e.name ?? ''}\n${(e.plot || e.overview || '').trim()}`)
    .join('\n\n');

  const beats = (season.beats ?? [])
    .map((b, i) => `  B${i + 1}. [${b.label}] ${b.text}`)
    .join('\n');

  const chars = (season.characters ?? [])
    .map((c, i) => `  C${i + 1}. ${c.name} — ${c.line}`)
    .join('\n');

  const cliff = season.cliffhanger?.text
    ? `\nCLIFFHANGER:\n  X1. ${season.cliffhanger.text}`
    : '';

  return `You are fact-checking a recap of ${show.title} season ${seasonNo} against the plot summaries it was written from.

SOURCE — official episode plot summaries for this season, and the ONLY thing that counts as evidence:

${source}

RECAP UNDER REVIEW:

BEATS:
${beats}

CHARACTER CARDS:
${chars}${cliff}

Your job is to find claims the source does not support. Go line by line.

FLAG an item when:
- invented — it states an event, motive or outcome the source does not contain
- contradicted — the source says something incompatible with it
- misattributed — the event is real but the source gives it to a different character
- wrong_name — it names a person, place, faction or object that appears nowhere in the source, or gets a name wrong
- wrong_season — the detail is real for this show but the source for THIS season does not contain it

DO NOT FLAG:
- compression, paraphrase or summary — a beat covering three episodes in one sentence is doing its job
- dramatic or interpretive phrasing, as long as the underlying facts hold
- reasonable inference the source clearly implies without stating outright
- a character card describing someone's arc across the season in general terms
- anything you are merely unsure about

The cost of the two errors is not equal. A missed flag leaves one wrong sentence in a recap. A false flag sends a person to re-read a season that was fine, and enough of those make the whole report worth ignoring. When you cannot point to specific source text that establishes the problem, do not flag it.

For every flag, quote the exact source text that contradicts it, or state plainly that no source text covers it.

Severity:
- high — a viewer would come away believing something false about the show
- low — imprecise, overstated, or thin on support, but not misleading

Return ONLY valid JSON. An empty array is a valid and expected answer:

{
  "flags": [
    {
      "id": "B3",
      "type": "invented",
      "severity": "high",
      "claim": "the exact phrase from the recap that is wrong",
      "evidence": "the source text that contradicts it, or: no episode summary mentions this",
      "note": "one sentence on what is actually the case, if the source says"
    }
  ]
}`;
}

async function auditSeason(show, spine, seasonNo, opts) {
  const season = spine.seasons[String(seasonNo)];
  const srcSeason = show.seasons.find(s => s.season === Number(seasonNo));
  if (!season || !srcSeason) return null;

  const episodes = srcSeason.episodes ?? [];
  const sourced = episodes.filter(e => (e.plot || '').length > 80);
  if (!episodes.length || sourced.length / episodes.length < MIN_SOURCED_EPISODES) {
    return { season: seasonNo, skipped: `only ${sourced.length}/${episodes.length} episodes have source text` };
  }

  if (opts.dryRun) return { season: seasonNo, flags: [], dryRun: true };

  const parsed = extractJSON(await askClaude(buildPrompt(show, seasonNo, sourced, season), opts.model));
  return { season: seasonNo, flags: parsed.flags ?? [] };
}

const SEV = { high: '!!', low: ' ·' };

async function auditShow(slug, opts) {
  const show = JSON.parse(await readFile(resolve(DATA, `${slug}.json`), 'utf8'));
  const spine = JSON.parse(await readFile(resolve(DATA, `${slug}.spine.json`), 'utf8'));

  const wanted = opts.season
    ? [Number(opts.season)]
    : Object.keys(spine.seasons).map(Number).sort((a, b) => a - b);

  const results = (
    await mapLimit(wanted, opts.concurrency, async s => {
      try {
        return await auditSeason(show, spine, s, opts);
      } catch (e) {
        return { season: s, error: e.message };
      }
    })
  ).filter(Boolean);

  const all = results.flatMap(r => (r.flags ?? []).map(f => ({ ...f, season: r.season })));
  const high = all.filter(f => f.severity === 'high');
  const shown = opts.highOnly ? high : all;

  const head = `  ${slug.padEnd(18)}`;
  if (!all.length) {
    console.log(`${head} clean (${results.length} season${results.length === 1 ? '' : 's'})`);
  } else {
    console.log(`${head} ${high.length} high, ${all.length - high.length} low`);
  }
  for (const r of results) {
    if (r.skipped) console.log(`      S${r.season} skipped — ${r.skipped}`);
    if (r.error) console.log(`      S${r.season} ✗ ${r.error}`);
  }
  for (const f of shown) {
    console.log(`    ${SEV[f.severity] ?? ' ?'} S${f.season} ${f.id} ${f.type}`);
    console.log(`       claim: ${f.claim}`);
    console.log(`       source: ${f.evidence}`);
    if (f.note) console.log(`       ${f.note}`);
  }

  // Written whether or not anything was flagged: a clean report is the record
  // that this season was checked, which is the thing a later reader wants.
  await writeFile(
    resolve(DATA, `${slug}.audit.json`),
    JSON.stringify({ slug, auditedAt: new Date().toISOString(), results }, null, 2),
  );

  return { slug, high: high.length, low: all.length - high.length };
}

async function main() {
  const slugs = process.argv.includes('--all')
    ? (await readdir(DATA))
        .filter(f => f.endsWith('.spine.json') && !f.includes('bak'))
        .map(f => f.replace('.spine.json', ''))
        .sort()
    : [arg('--slug')].filter(Boolean);

  if (!slugs.length) {
    console.error('\n✗ pass --slug <name> or --all\n');
    process.exit(1);
  }

  const opts = {
    season: arg('--season'),
    model: arg('--model'),
    highOnly: process.argv.includes('--high-only'),
    dryRun: process.argv.includes('--dry-run'),
    concurrency: CONCURRENCY,
  };

  console.log('');
  const totals = [];
  for (const slug of slugs) {
    try {
      totals.push(await auditShow(slug, opts));
    } catch (e) {
      console.log(`  ${slug.padEnd(18)} ✗ ${e.message}`);
    }
  }

  const high = totals.reduce((a, t) => a + t.high, 0);
  const low = totals.reduce((a, t) => a + t.low, 0);
  console.log(`\n  ${totals.length} shows · ${high} high · ${low} low\n`);
}

main().catch(e => {
  console.error(`\n✗ ${e.message}\n`);
  process.exit(1);
});
