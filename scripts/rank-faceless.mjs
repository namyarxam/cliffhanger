#!/usr/bin/env node
/**
 * The worklist for _cast-images.json: which missing portraits are worth
 * sourcing by hand, and which to let the drop rule take.
 *
 * WHY A SCORE RATHER THAN "IS IT ANIMATED"
 *
 * Whether a missing face matters is a question about the character, not the
 * show. BoJack's fifteen faceless cards were every one of them ranked 6th to
 * 8th — genuinely minor. Invincible's were Atom Eve, Cecil Stedman and Allen
 * the Alien, who rank ABOVE characters that do have pictures. Same cause, and
 * the right answer is opposite in the two cases.
 *
 * Three signals, none trusted alone:
 *
 *   rank      Position in the season's character list, which generate-spine
 *             orders most-essential-first. The strongest signal, and the
 *             weakest evidence: it is a prompt instruction nothing verifies.
 *   recur     Fraction of the show's seasons the character appears in.
 *             Normalised, so a 2-season show is judged like an 8-season one.
 *   mentions  Times named in that season's beat text. The most trustworthy of
 *             the three: being named in the causal spine is much closer to
 *             "the viewer needs this person" than screen time is. The Immortal
 *             has 21 episodes and is never named in a beat.
 *
 * Episode count is deliberately NOT scored. It measures how much an actor
 * worked, which is not the same as how much the recap leans on the character.
 *
 * Usage:
 *   node scripts/rank-faceless.mjs                # whole library
 *   node scripts/rank-faceless.mjs --slug bojack-horseman
 *   node scripts/rank-faceless.mjs --keep 30      # move the keep/drop line
 *   node scripts/rank-faceless.mjs --stub         # emit _cast-images.json rows
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bestMatch, tokens, tokenOwners } from './name-match.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'src/recap/data');
const MAX_CHARACTER_CARDS = 8;

const arg = (f, d = null) => {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : d;
};
const KEEP = Number(arg('--keep', 25));
const only = arg('--slug');
const stub = process.argv.includes('--stub');

let overrides = {};
try {
  overrides = JSON.parse(readFileSync(resolve(DATA, '_cast-images.json'), 'utf8'));
  delete overrides._readme;
} catch { /* no overrides yet */ }

const slugs = only
  ? [only]
  : JSON.parse(readFileSync(resolve(ROOT, 'scripts/batch-manifest.json'), 'utf8')).shows.map(s => s.slug);

const rows = [];
for (const slug of slugs) {
  const sp = resolve(DATA, `${slug}.spine.json`), dj = resolve(DATA, `${slug}.json`);
  if (!existsSync(sp) || !existsSync(dj)) continue;
  const spine = JSON.parse(readFileSync(sp, 'utf8'));
  const data = JSON.parse(readFileSync(dj, 'utf8'));
  const cast = (data.cast ?? []).filter(c => c.character);
  const owners = tokenOwners(cast.map(c => c.character));
  const cands = cast.map(c => ({ name: c.character, weight: c.episodeCount ?? 0, row: c }));
  const animated =
    data.showType === 'Animation' || (data.genres ?? []).some(g => /animation|anime/i.test(g));
  const links = spine.castLinks ?? {};
  const over = overrides[slug] ?? {};
  const nSeasons = Object.keys(spine.seasons).length;

  const pictured = name => {
    if (over[name]) return true;
    const l = links[name]
      ? cast.find(c => c.name === links[name].actor && c.character === links[name].character)
      : null;
    const row = l ?? bestMatch(name, cands, owners)?.row ?? null;
    return !!(row && (animated ? row.inCharacter : (row.inCharacter ?? row.profile)));
  };

  const agg = {};
  for (const entry of Object.values(spine.seasons)) {
    const claimed = new Set(), dedup = [];
    for (const c of entry.characters ?? []) {
      const row = bestMatch(c.name, cands, owners)?.row ?? null;
      const key = row ? `${row.name}|${row.character}` : null;
      if (key && claimed.has(key)) continue;
      if (key) claimed.add(key);
      dedup.push(c);
    }
    const prose = [
      ...(entry.beats ?? []).map(b => `${b.label} ${b.text}`),
      entry.cliffhanger?.text ?? '',
    ].join(' ').toLowerCase();

    dedup.slice(0, MAX_CHARACTER_CARDS).forEach((c, i) => {
      const a = (agg[c.name] ??= { ranks: [], seasons: 0, mentions: 0 });
      a.ranks.push(i + 1);
      a.seasons++;
      // length > 2, so a three-letter name (Eve, Vi, Ian) is not silently
      // dropped — that undercounted Atom Eve to zero mentions.
      let hit = 0;
      for (const t of [...new Set(tokens(c.name))].filter(t => t.length > 2)) {
        const m = prose.match(new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
        if (m) hit = Math.max(hit, m.length);
      }
      a.mentions += hit;
    });
  }

  for (const [name, a] of Object.entries(agg)) {
    if (pictured(name)) continue;
    const best = Math.min(...a.ranks);
    const score = (9 - best) * 3 + (a.seasons / nSeasons) * 8 + Math.min(a.mentions, 12);
    rows.push({
      slug, name, animated, best, seasons: a.seasons, nSeasons,
      mentions: a.mentions, cards: a.ranks.length,
      score: Math.round(score), keep: score >= KEEP,
    });
  }
}

const keep = rows.filter(r => r.keep).sort((a, b) => b.score - a.score);
const drop = rows.filter(r => !r.keep);

if (stub) {
  const byShow = {};
  for (const k of keep) (byShow[k.slug] ??= {})[k.name] = '';
  console.log(JSON.stringify(byShow, null, 2));
  process.exit(0);
}

console.log(`\nfaceless characters: ${rows.length}   (keep line: score >= ${KEEP})\n`);
console.log(`  SOURCE AN IMAGE : ${keep.length}  (${keep.reduce((a, r) => a + r.cards, 0)} card slots)`);
console.log(`  LET IT DROP     : ${drop.length}  (${drop.reduce((a, r) => a + r.cards, 0)} card slots)\n`);
console.log('  score  rank  seasons  mentions  show / character');
for (const r of keep) {
  console.log(
    `  ${String(r.score).padStart(5)}${String(r.best).padStart(6)}` +
    `${`${r.seasons}/${r.nSeasons}`.padStart(9)}${String(r.mentions).padStart(10)}  ` +
    `${r.slug}${r.animated ? ' *' : ''} / ${r.name}`,
  );
}
console.log(`\n  * animated — no actor headshot may stand in, so only a hand-sourced image helps.`);
console.log(`  Add URLs to src/recap/data/_cast-images.json, then re-run upload-recap.`);
