#!/usr/bin/env node
/**
 * Rewrite the items audit-spine.mjs flagged, using the audit's own evidence.
 *
 * WHY REPAIR RATHER THAN REGENERATE
 *
 * A flagged spine is not a bad spine. Across Better Call Saul, 8 of 86 items
 * were flagged — the other 78 survived a line-by-line check against source and
 * are the version a person already read and approved. Regenerating the season
 * throws all of that away and re-rolls the 90% that was right, which is both
 * more expensive and strictly worse: every regeneration is a fresh chance to
 * introduce a new error in text that was previously fine.
 *
 * So this rewrites exactly the flagged items and nothing else.
 *
 * WHY THE FLAGS GO IN AS DATA
 *
 * The same lesson as repair-characters.mjs, learned the same way: telling a
 * model to "be consistent with the source" does not work, and was ignored
 * twice. What works is handing over the finding already made — the claim, the
 * source text that contradicts it, and what is actually the case — and asking
 * only for replacement prose. The judgement has already happened in the audit;
 * this step is execution, and framing it as execution is what makes it
 * reliable.
 *
 * The source summaries go in alongside, because a correction still has to be
 * written from something, and the evidence quote alone is too narrow to
 * rewrite a sentence that also has to carry the season.
 *
 * Usage:
 *   node scripts/repair-flags.mjs --slug better-call-saul
 *   node scripts/repair-flags.mjs --slug better-call-saul --dry-run
 *   node scripts/repair-flags.mjs --all --high-only
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'src/recap/data');

// Must match generate-spine.mjs. A repaired beat that blows the ceiling is a
// layout bug shipped to fix a factual one.
const BEAT_CHAR_LIMIT = 180;
const BEAT_TARGET = 150;

const arg = (flag, fallback = null) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const CONCURRENCY = Number(arg('--concurrency', 6));

async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await worker(items[i], i);
      }
    }),
  );
  return out;
}

function askClaude(prompt, model = null) {
  return new Promise((res, rej) => {
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

/** "B3" / "C6" / "X1" → the live object on the spine, or null. */
function locate(season, id) {
  const kind = id[0];
  const n = Number(id.slice(1)) - 1;
  if (kind === 'B') return season.beats?.[n] ? { obj: season.beats[n], field: 'text', kind } : null;
  if (kind === 'C')
    return season.characters?.[n] ? { obj: season.characters[n], field: 'line', kind } : null;
  if (kind === 'X')
    return season.cliffhanger ? { obj: season.cliffhanger, field: 'text', kind } : null;
  return null;
}

const KIND_RULES = {
  B: `A BEAT is one caption over a full-screen image. Aim for about ${BEAT_TARGET} characters; ${BEAT_CHAR_LIMIT} is a hard ceiling. It states what happened and why it matters causally — it is a link in a chain, not a highlight.`,
  C: `A CHARACTER LINE is one sentence saying who this person is AT THE END of this season — their position and current situation, not their whole arc.`,
  X: `A CLIFFHANGER is one or two sentences naming the unresolved situation the viewer is walking back into. It poses; it does not answer.`,
};

function buildPrompt(show, seasonNo, episodes, items) {
  const source = episodes
    .map(e => `[S${seasonNo}E${e.episode}] ${e.name ?? ''}\n${(e.plot || e.overview || '').trim()}`)
    .join('\n\n');

  const list = items
    .map(
      ({ id, current, flag }) => `${id}
  CURRENT TEXT : ${current}
  PROBLEM      : ${flag.type} — ${flag.claim}
  SOURCE SAYS  : ${flag.evidence}${flag.note ? `\n  CORRECTION   : ${flag.note}` : ''}`,
    )
    .join('\n\n');

  const kinds = [...new Set(items.map(i => i.id[0]))].map(k => `- ${KIND_RULES[k]}`).join('\n');

  return `Rewrite specific lines in a recap of ${show.title} season ${seasonNo} so they match the source.

SOURCE — official episode plot summaries for this season:

${source}

ITEMS TO REWRITE. Each has already been checked against the source and found wrong. The problem and the correction are given; you do not need to re-diagnose them.

${list}

FORMAT RULES:
${kinds}

How to rewrite:
- Fix ONLY the identified problem. Everything else in the line was checked and is correct — preserve it, including phrasing, names and emphasis.
- Prefer the smallest edit that makes the line true. Changing one clause beats rewriting the sentence.
- Where the source does not support a detail at all, cut it rather than replacing it with a guess. A shorter true line is better than a longer invented one.
- Where the source contradicts the line, follow the source, not your own knowledge of the show. The source is the bound — a detail you know to be true from later seasons is a spoiler here, not a correction.
- Keep the same voice and tense as the original.
- Do not add new proper nouns that do not appear in the source for this season.

Return ONLY valid JSON mapping each id to its replacement text:

{
  "fixes": {
${items.slice(0, 2).map(i => `    ${JSON.stringify(i.id)}: "rewritten text"`).join(',\n')}
  }
}`;
}

async function repairSeason(show, spine, audit, seasonNo, opts) {
  const season = spine.seasons[String(seasonNo)];
  const srcSeason = show.seasons.find(s => s.season === Number(seasonNo));
  const flags = (audit.results.find(r => r.season === Number(seasonNo))?.flags ?? []).filter(
    f => !opts.highOnly || f.severity === 'high',
  );
  if (!season || !srcSeason || !flags.length) return { season: seasonNo, fixed: 0, items: [] };

  // A flag pointing at an index that no longer exists means the spine moved
  // under the audit. Repairing from a stale report would rewrite the wrong
  // line, which is worse than not repairing at all.
  const items = [];
  for (const flag of flags) {
    const hit = locate(season, flag.id);
    if (!hit) {
      console.log(`      S${seasonNo} ${flag.id} ✗ not on spine — audit is stale, re-run it`);
      continue;
    }
    items.push({ id: flag.id, current: hit.obj[hit.field], flag, hit });
  }
  if (!items.length) return { season: seasonNo, fixed: 0, items: [] };
  if (opts.dryRun) return { season: seasonNo, fixed: 0, items, dryRun: true };

  const sourced = (srcSeason.episodes ?? []).filter(e => (e.plot || '').length > 80);
  const parsed = extractJSON(await askClaude(buildPrompt(show, seasonNo, sourced, items), opts.model));

  const applied = [];
  for (const item of items) {
    const next = parsed.fixes?.[item.id];
    if (typeof next !== 'string' || !next.trim()) {
      console.log(`      S${seasonNo} ${item.id} · no replacement returned, left as-is`);
      continue;
    }
    if (item.id[0] === 'B' && next.length > BEAT_CHAR_LIMIT) {
      console.log(
        `      S${seasonNo} ${item.id} ✗ replacement ${next.length} chars > ${BEAT_CHAR_LIMIT}, left as-is`,
      );
      continue;
    }
    applied.push({ id: item.id, before: item.current, after: next.trim() });
    item.hit.obj[item.hit.field] = next.trim();
  }
  return { season: seasonNo, fixed: applied.length, items, applied };
}

async function repairShow(slug, opts) {
  const show = JSON.parse(await readFile(resolve(DATA, `${slug}.json`), 'utf8'));
  const spinePath = resolve(DATA, `${slug}.spine.json`);
  const spine = JSON.parse(await readFile(spinePath, 'utf8'));

  let audit;
  try {
    audit = JSON.parse(await readFile(resolve(DATA, `${slug}.audit.json`), 'utf8'));
  } catch {
    console.log(`  ${slug.padEnd(18)} no audit — run audit-spine.mjs first`);
    return { slug, fixed: 0 };
  }

  const seasons = audit.results.filter(r => (r.flags ?? []).length).map(r => r.season);
  if (!seasons.length) {
    console.log(`  ${slug.padEnd(18)} nothing flagged`);
    return { slug, fixed: 0 };
  }

  const results = await mapLimit(seasons, opts.concurrency, async s => {
    try {
      return await repairSeason(show, spine, audit, s, opts);
    } catch (e) {
      console.log(`      S${s} ✗ ${e.message}`);
      return { season: s, fixed: 0 };
    }
  });

  const fixed = results.reduce((a, r) => a + r.fixed, 0);
  console.log(`  ${slug.padEnd(18)} ${fixed} fixed`);
  for (const r of results) {
    for (const a of r.applied ?? []) {
      console.log(`    S${r.season} ${a.id}`);
      console.log(`      −  ${a.before}`);
      console.log(`      +  ${a.after}`);
    }
    for (const i of r.items ?? []) if (r.dryRun) console.log(`    S${r.season} ${i.id} would fix`);
  }

  if (fixed && !opts.dryRun) {
    // Stamped so a later reader can tell repaired text from generated text,
    // and so a re-audit that still flags something is distinguishable from one
    // that was never repaired.
    spine.repairedAt = new Date().toISOString();
    await writeFile(spinePath, JSON.stringify(spine, null, 2));
  }
  return { slug, fixed };
}

async function main() {
  const slugs = process.argv.includes('--all')
    ? (await readdir(DATA))
        .filter(f => f.endsWith('.audit.json'))
        .map(f => f.replace('.audit.json', ''))
        .sort()
    : [arg('--slug')].filter(Boolean);

  if (!slugs.length) {
    console.error('\n✗ pass --slug <name> or --all\n');
    process.exit(1);
  }

  const opts = {
    model: arg('--model'),
    highOnly: process.argv.includes('--high-only'),
    dryRun: process.argv.includes('--dry-run'),
    concurrency: CONCURRENCY,
  };

  console.log('');
  let total = 0;
  for (const slug of slugs) {
    try {
      total += (await repairShow(slug, opts)).fixed;
    } catch (e) {
      console.log(`  ${slug.padEnd(18)} ✗ ${e.message}`);
    }
  }
  console.log(`\n  ${total} item(s) rewritten. Re-run audit-spine.mjs to verify.\n`);
}

main().catch(e => {
  console.error(`\n✗ ${e.message}\n`);
  process.exit(1);
});
