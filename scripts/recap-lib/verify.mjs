// Source-grounded fact-check of a generated spine, with repair.
//
// Three rules carried from a month of running the old audit, each learned the
// expensive way:
//
// 1. PER-SEASON AUDIT ONLY. Whole-show auditing was tested and rejected — it
//    missed 75% of flags on a five-season show. Accuracy > tokens, always.
//
// 2. CONTRADICTION IS NOT OMISSION. A recap may be more specific than its
//    source; only source text incompatible with a claim is an error. Measured
//    precision without this rule was 2/8 — six false flags sent a person
//    re-reading seasons that were fine.
//
// 3. VERDICTS ARE CONTENT-ADDRESSED. Re-running a model audit on unchanged
//    text yields a different list forever, which reads like the library
//    degrading when it is not — and on a subscription every re-run costs a
//    call. So each verdict is cached under a hash of (season entry + source
//    text): re-running the pipeline re-verifies nothing unless the text
//    actually changed, which makes the audit converge like a deterministic
//    check while still being a model underneath.
//
// Repair hands the flags over AS DATA — the claim, the evidence, what is
// actually the case — and asks only for replacement prose. Telling a model to
// "be consistent with the source" was ignored twice; framing repair as
// execution of a finding already made is what made it reliable. Only flagged
// items are rewritten: every regeneration of clean text is a fresh chance to
// break it.

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { WORK } from './env.mjs';
import { askValidated } from './model.mjs';
import { BEAT_CHAR_LIMIT } from './spine.mjs';

/** A season needs this share of episodes with real plot text to be auditable. */
const MIN_SOURCED = 0.6;
/** Repair rounds before a season is refused rather than shipped inaccurate. */
const MAX_ROUNDS = 2;
const BEAT_HARD_LIMIT = 260;

const CACHE_PATH = resolve(WORK, '_verify-cache.json');

export async function loadVerifyCache() {
  try {
    return JSON.parse(await readFile(CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

async function saveVerifyCache(cache) {
  await mkdir(WORK, { recursive: true });
  await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));
}

const sha = s => createHash('sha256').update(s).digest('hex');

// ---------------------------------------------------------------- audit

function sourceFor(show, seasonNo) {
  const season = show.seasons.find(s => s.season === seasonNo);
  const episodes = season?.episodes ?? [];
  const sourced = episodes.filter(e => (e.plot || '').length > 80);
  return { episodes, sourced };
}

function auditPrompt(show, seasonNo, sourced, entry) {
  const source = sourced
    .map(e => `[S${seasonNo}E${e.episode}] ${e.name ?? ''}\n${(e.plot || e.overview || '').trim()}`)
    .join('\n\n');
  const beats = (entry.beats ?? []).map((b, i) => `  B${i + 1}. [${b.label}] ${b.text}`).join('\n');
  const chars = (entry.characters ?? []).map((c, i) => `  C${i + 1}. ${c.name} — ${c.line}`).join('\n');
  const cliff = entry.cliffhanger?.text ? `\nCLIFFHANGER:\n  X1. ${entry.cliffhanger.text}` : '';

  return `You are fact-checking a recap of ${show.title} season ${seasonNo} against the plot summaries it was written from.

SOURCE — episode plot summaries for this season, and the ONLY thing that counts as evidence:

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

function validFlagShape(parsed, entry) {
  const p = [];
  if (!Array.isArray(parsed?.flags)) return ['`flags` must be an array (empty is fine)'];
  const beatCount = entry.beats?.length ?? 0;
  const charCount = entry.characters?.length ?? 0;
  for (const [i, f] of parsed.flags.entries()) {
    if (!/^([BC]\d+|X1)$/.test(f?.id ?? '')) p.push(`flag ${i + 1}: id must be B<n>, C<n> or X1`);
    else {
      const n = Number(f.id.slice(1));
      if (f.id[0] === 'B' && n > beatCount) p.push(`flag ${i + 1}: ${f.id} but only ${beatCount} beats exist`);
      if (f.id[0] === 'C' && n > charCount) p.push(`flag ${i + 1}: ${f.id} but only ${charCount} character cards exist`);
    }
    if (!['high', 'low'].includes(f?.severity)) p.push(`flag ${i + 1}: severity must be high or low`);
    if (!f?.claim) p.push(`flag ${i + 1}: missing claim`);
  }
  return p;
}

/**
 * Audit one season's entry. Returns { flags, skipped?, cached? }.
 */
export async function verifySeason(show, seasonNo, entry, { cache, model = null }) {
  const { episodes, sourced } = sourceFor(show, seasonNo);
  if (!episodes.length || sourced.length / episodes.length < MIN_SOURCED) {
    return { flags: [], skipped: `only ${sourced.length}/${episodes.length} episodes have source text` };
  }

  const key = sha(
    JSON.stringify({
      v: 1,
      slug: show.slug,
      season: seasonNo,
      entry: { beats: entry.beats, characters: entry.characters, cliffhanger: entry.cliffhanger },
      source: sha(sourced.map(e => `${e.episode}|${e.plot || e.overview || ''}`).join('\n')),
    }),
  );
  if (cache[key]) return { flags: cache[key].flags, cached: true };

  const parsed = await askValidated(
    auditPrompt(show, seasonNo, sourced, entry),
    p => validFlagShape(p, entry),
    model,
    `S${seasonNo} audit`,
  );
  cache[key] = { flags: parsed.flags, at: new Date().toISOString() };
  await saveVerifyCache(cache);
  return { flags: parsed.flags };
}

// ---------------------------------------------------------------- repair

function repairPrompt(show, seasonNo, sourced, entry, flags) {
  const source = sourced
    .map(e => `[S${seasonNo}E${e.episode}] ${e.name ?? ''}\n${(e.plot || e.overview || '').trim()}`)
    .join('\n\n');

  const items = flags
    .map(f => {
      const current =
        f.id[0] === 'B'
          ? entry.beats[Number(f.id.slice(1)) - 1]?.text
          : f.id[0] === 'C'
            ? entry.characters[Number(f.id.slice(1)) - 1]?.line
            : entry.cliffhanger?.text;
      return `${f.id} (${f.type}):
  CURRENT TEXT: ${current}
  PROBLEM: ${f.claim}
  EVIDENCE: ${f.evidence ?? '(none quoted)'}
  WHAT IS ACTUALLY THE CASE: ${f.note ?? '(see evidence)'}`;
    })
    .join('\n\n');

  return `You are repairing a TV recap of ${show.title} season ${seasonNo}. Each item below has already been checked against the source and found wrong. The problem and the correction are given; you do not need to re-diagnose them. Your job is replacement prose only.

SOURCE — episode plot summaries, the only thing that counts as fact:

${source}

ITEMS TO REWRITE:

${items}

How to rewrite:
- Keep the correction. That is the whole point — do not restore the error to save room.
- Change as little else as possible. The surrounding sentence structure was reviewed and approved; you are excising a wrong fact, not re-authoring the item.
- Beats (B*): two sentences max, present tense, about 150 characters, ${BEAT_CHAR_LIMIT} is the ceiling. Concrete and plain.
- Character lines (C*): one sentence — who they are and where they stand at the END of season ${seasonNo}.
- Cliffhanger (X1): one or two sentences on the unresolved situation. Do not change the questions.
- Every factual claim in your replacement must be supported by the source above.

Return ONLY valid JSON mapping each item id to its replacement text:

{
  ${flags.map(f => `"${f.id}": "replacement text"`).join(',\n  ')}
}`;
}

/**
 * Rewrite exactly the flagged items, in a copy of the entry.
 */
async function repairSeason(show, seasonNo, entry, flags, model) {
  const { sourced } = sourceFor(show, seasonNo);
  const validate = parsed => {
    const p = [];
    for (const f of flags) {
      const t = parsed?.[f.id];
      if (!t || typeof t !== 'string') p.push(`missing replacement for ${f.id}`);
      else if (f.id[0] === 'B' && t.length > BEAT_HARD_LIMIT)
        p.push(`${f.id}: ${t.length} chars — far over the ${BEAT_CHAR_LIMIT}-char ceiling; shorten it`);
    }
    return p;
  };
  const parsed = await askValidated(
    repairPrompt(show, seasonNo, sourced, entry, flags),
    validate,
    model,
    `S${seasonNo} repair`,
  );

  const next = structuredClone(entry);
  for (const f of flags) {
    const t = parsed[f.id];
    if (f.id[0] === 'B') next.beats[Number(f.id.slice(1)) - 1].text = t;
    else if (f.id[0] === 'C') next.characters[Number(f.id.slice(1)) - 1].line = t;
    else next.cliffhanger.text = t;
  }
  return next;
}

// ---------------------------------------------------------------- loop

/**
 * Verify every season, repairing high-severity flags, up to MAX_ROUNDS.
 *
 * Returns { seasons, report, ok }. `seasons` is the (possibly repaired) spine.
 * `ok` is false when any season still carries high flags after the last round
 * — accuracy-first: such a season is refused, never shipped.
 */
export async function verifyAndRepair(data, spineSeasons, { model = null } = {}) {
  const cache = await loadVerifyCache();
  const seasons = { ...spineSeasons };
  const report = {};
  let ok = true;

  for (const n of Object.keys(seasons).map(Number).sort((a, b) => a - b)) {
    let entry = seasons[n];
    let rounds = 0;
    let result = await verifySeason(data, n, entry, { cache, model });

    if (result.skipped) {
      console.log(`  S${n}: audit skipped — ${result.skipped}`);
      report[n] = { flags: [], skipped: result.skipped, rounds };
      continue;
    }

    let high = result.flags.filter(f => f.severity === 'high');
    console.log(
      `  S${n}: ${result.flags.length} flag(s), ${high.length} high${result.cached ? ' (cached)' : ''}`,
    );

    while (high.length && rounds < MAX_ROUNDS) {
      rounds += 1;
      console.log(`    repairing ${high.length} high-severity item(s), round ${rounds}`);
      entry = await repairSeason(data, n, entry, high, model);
      result = await verifySeason(data, n, entry, { cache, model });
      high = result.flags.filter(f => f.severity === 'high');
      console.log(`    re-audit: ${result.flags.length} flag(s), ${high.length} high`);
    }

    seasons[n] = entry;
    report[n] = { flags: result.flags, rounds };
    if (high.length) {
      ok = false;
      console.error(`  ✗ S${n} still has ${high.length} high-severity flag(s) after ${rounds} repair round(s):`);
      for (const f of high) console.error(`      ${f.id} ${f.type}: ${f.claim}`);
    }
  }

  return { seasons, report, ok };
}
