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
/** Loose containment test — the audit quotes a claim, not always verbatim. */
const holds = (field, claim) => {
  if (!field || !claim) return false;
  const norm = t => String(t).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const f = norm(field), c = norm(claim);
  if (!c) return false;
  if (f.includes(c)) return true;
  // Or a strong majority of the claim's words appear in the field.
  const words = c.split(' ').filter(w => w.length > 3);
  if (!words.length) return false;
  return words.filter(w => f.includes(w)).length / words.length >= 0.75;
};

/**
 * Find the item a flag points at, AND the field within it that is actually wrong.
 *
 * This used to hardcode `text` for a beat and `line` for a character, which made
 * a whole class of error permanently unrepairable. A beat's LABEL and a
 * character's NAME both ship to the device, and both were flagged repeatedly —
 * Downton Abbey S3 was labelled with a death the season never covers, She-Ra S4
 * with an arrival from S5, Justified S5 with a murder from another season. Every
 * round, repair rewrote the body underneath a wrong title, the audit re-flagged
 * the title, and the show burned its retries without one character changing.
 *
 * The audit does not say which field it means, so match its quoted claim against
 * each candidate and repair the one that contains it. Body first, since that is
 * where most claims live and where a tie should land.
 */
function locate(season, id, flag) {
  const kind = id[0];
  const n = Number(id.slice(1)) - 1;
  const pick = (obj, fields) => {
    if (!obj) return null;
    const hit = fields.find(f => holds(obj[f], flag?.claim));
    return { obj, field: hit ?? fields[0], kind };
  };
  if (kind === 'B') return pick(season.beats?.[n], ['text', 'label']);
  if (kind === 'C') {
    const obj = season.characters?.[n];
    if (!obj) return null;
    // The audit writes a character claim as "Name — role line", so the line
    // shares words with the claim even when the NAME is what is wrong. Its own
    // flag type settles it: wrong_name means the name.
    if (flag?.type === 'wrong_name') return { obj, field: 'name', kind };
    return pick(obj, ['line', 'name']);
  }
  if (kind === 'X') return pick(season.cliffhanger, ['text']);
  return null;
}

const KIND_RULES = {
  B: `A BEAT is one caption over a full-screen image. Aim for about ${BEAT_TARGET} characters; ${BEAT_CHAR_LIMIT} is a hard ceiling. It states what happened and why it matters causally — it is a link in a chain, not a highlight.`,
  C: `A CHARACTER LINE is one sentence saying who this person is AT THE END of this season — their position and current situation, not their whole arc.`,
  X: `A CLIFFHANGER is one or two sentences naming the unresolved situation the viewer is walking back into. It poses; it does not answer.`,
  'B.label': `A BEAT LABEL is the short title above the caption, in the form "S3 · Three or four words". Keep the "S<n> · " prefix exactly as it is. It names what the beat is about using only what THIS season establishes — never a person or event the season's own source does not contain.`,
  'C.name': `A CHARACTER NAME is how the recap refers to this person, and it is matched against the cast list to choose their photo. Use the name this season's source actually uses. Do not use a name the season never uses, even if it is what they are called later.`,
};

// A correct rewrite that overruns the ceiling used to be dropped on the floor,
// which is how a show gets stuck: the beat is never changed, so the next audit
// raises the identical flag, forever. Succession S2 B6 came back at 181 chars
// against a 180 ceiling and burned both repair rounds on a one-character miss.
// The fix is not a bigger ceiling — the ceiling is a layout constraint — it is
// to hand the overrun back and ask for the same correction in fewer words.
function buildShortenPrompt(show, seasonNo, overruns) {
  const list = overruns
    .map(
      ({ id, attempt, flag }) => `${id}  (${attempt.length} chars — must be ${BEAT_CHAR_LIMIT} or fewer)
  TOO LONG     : ${attempt}
  MUST STILL FIX: ${flag.type} — ${flag.note || flag.claim}`,
    )
    .join('\n\n');

  return `These rewritten beats from a recap of ${show.title} season ${seasonNo} are factually correct but too long.

${list}

Compress each to ${BEAT_CHAR_LIMIT} characters or fewer, aiming for about ${BEAT_TARGET}.

- Keep the correction. That is the whole point of the rewrite — do not restore the error to save room.
- Cut the least load-bearing clause first. Trailing consequence beats the causal link; a name you can drop without confusion beats a verb.
- Do not introduce anything the previous version did not already say.
- Keep the same voice and tense.

Return ONLY valid JSON:

{
  "fixes": {
${overruns.slice(0, 2).map(o => `    ${JSON.stringify(o.id)}: "shorter text"`).join(',\n')}
  }
}`;
}

function buildPrompt(show, seasonNo, episodes, items) {
  const source = episodes
    .map(e => `[S${seasonNo}E${e.episode}] ${e.name ?? ''}\n${(e.plot || e.overview || '').trim()}`)
    .join('\n\n');

  const list = items
    .map(
      ({ id, current, flag, hit }) => `${id}${hit?.field && hit.field !== 'text' ? `  (the ${hit.field.toUpperCase()}, not the body)` : ''}
  CURRENT TEXT : ${current}
  PROBLEM      : ${flag.type} — ${flag.claim}
  SOURCE SAYS  : ${flag.evidence}${flag.note ? `\n  CORRECTION   : ${flag.note}` : ''}`,
    )
    .join('\n\n');

  // Key by kind AND field, so a label repair is told the label's rules.
  const kinds = [...new Set(items.map(i => {
    const k = i.id[0];
    const special = `${k}.${i.hit?.field}`;
    return KIND_RULES[special] ? special : k;
  }))].map(k => `- ${KIND_RULES[k]}`).join('\n');

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
    const hit = locate(season, flag.id, flag);
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
  let overruns = [];
  for (const item of items) {
    const next = parsed.fixes?.[item.id];
    if (typeof next !== 'string' || !next.trim()) {
      console.log(`      S${seasonNo} ${item.id} · no replacement returned, left as-is`);
      continue;
    }
    // Measure what actually gets stored. The old check measured the raw string
    // and stored the trimmed one, so a beat could be rejected for whitespace.
    const text = next.trim();
    if (item.id[0] === 'B' && item.hit.field === 'text' && text.length > BEAT_CHAR_LIMIT) {
      overruns.push({ id: item.id, attempt: text, flag: item.flag, item });
      continue;
    }
    applied.push({ id: item.id, before: item.current, after: text });
    item.hit.obj[item.hit.field] = text;
  }

  // Two compression attempts. Each one is a cheap single call over a handful of
  // beats, and it is the difference between a show shipping and being dropped.
  for (let attempt = 1; attempt <= 2 && overruns.length; attempt++) {
    let shorter;
    try {
      shorter = extractJSON(
        await askClaude(buildShortenPrompt(show, seasonNo, overruns), opts.model),
      );
    } catch {
      break;
    }
    const still = [];
    for (const o of overruns) {
      const next = shorter.fixes?.[o.id];
      const text = typeof next === 'string' ? next.trim() : '';
      if (!text || text.length > BEAT_CHAR_LIMIT) {
        still.push({ ...o, attempt: text || o.attempt });
        continue;
      }
      console.log(`      S${seasonNo} ${o.id} ✓ shortened to ${text.length} chars`);
      applied.push({ id: o.id, before: o.item.current, after: text });
      o.item.hit.obj[o.item.hit.field] = text;
    }
    overruns = still;
  }
  for (const o of overruns) {
    console.log(
      `      S${seasonNo} ${o.id} ✗ still ${o.attempt.length} chars > ${BEAT_CHAR_LIMIT} after 2 tries, left as-is`,
    );
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
