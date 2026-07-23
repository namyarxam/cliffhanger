#!/usr/bin/env node
/**
 * Spine QA — the gate a generated show must pass before it ships.
 *
 * Generation is unattended and will eventually run over hundreds of shows, so
 * "read it and see if it looks right" does not scale. This checks the
 * properties that are objectively checkable, and reports the ones that need a
 * human read as a short list rather than a full script.
 *
 * The spoiler check is the important one. Wikipedia article pages carry EVERY
 * aired season, so the source material handed to the generator for season N
 * has, sitting right next to it, the events of season N+1. A leak there is not
 * a cosmetic bug — it is the feature actively doing the thing it exists to
 * prevent. It is checked heuristically (later-season proper nouns appearing in
 * an earlier season's text), which over-reports rather than under-reports, on
 * the grounds that a false positive costs a glance and a false negative ships.
 *
 * Usage:
 *   node scripts/inspect-spine.mjs --slug expanse
 *   node scripts/inspect-spine.mjs --slug expanse --spine expanse.spine.wholeshow.json
 *   node scripts/inspect-spine.mjs --slug expanse --compare expanse.spine.wholeshow.json
 */

import { readFile } from 'node:fs/promises';
import { coherence } from './coherence.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BEAT_CHAR_LIMIT = 180;

const arg = (flag, fallback = null) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const load = async name => JSON.parse(await readFile(resolve(ROOT, `src/recap/data/${name}`), 'utf8'));

// --- spoiler heuristic ------------------------------------------------------

/**
 * Proper nouns that appear in a season's source but in NO earlier season's.
 *
 * A name that debuts in S4's episode summaries is, by construction, something
 * the S1-S3 viewer has not met. If it turns up in an S1 beat, either the
 * generator leaked forward or the name is a coincidence — both are worth a
 * look. Stop-listing the show's own title words keeps the noise down.
 */
function novelTermsBySeason(data) {
  const proper = text =>
    new Set(
      (text.match(/\b[A-Z][a-z]{3,}\b/g) ?? []).filter(
        w => !STOPWORDS.has(w) && !data.title.includes(w),
      ),
    );

  const seen = new Set();
  const bySeason = new Map();
  for (const s of data.seasons) {
    const terms = proper(
      s.episodes.map(e => `${e.name} ${e.plot ?? e.overview ?? ''}`).join(' '),
    );
    bySeason.set(s.season, new Set([...terms].filter(t => !seen.has(t))));
    terms.forEach(t => seen.add(t));
  }
  return bySeason;
}

const STOPWORDS = new Set([
  'The', 'This', 'That', 'They', 'Their', 'When', 'While', 'With', 'After',
  'Before', 'Then', 'From', 'Into', 'Meanwhile', 'However', 'Later', 'Season',
  'Episode', 'Series', 'Part', 'Both', 'What', 'Where', 'Which', 'These',
  'Those', 'Some', 'Once', 'Only', 'Also', 'Just', 'Over', 'Under', 'Team',
  // Sentence-initial common words. Capitalisation is the whole signal here, so
  // anything that routinely starts a sentence reads as a proper noun and has to
  // be named explicitly.
  'Everyone', 'Everything', 'Someone', 'Something', 'Nobody', 'Nothing',
  'Another', 'Because', 'During', 'Since', 'Though', 'Until', 'Whether',
  'Their', 'There', 'Three', 'Four', 'Five', 'Several', 'Following',
]);

function spoilerScan(data, spine) {
  const novel = novelTermsBySeason(data);
  const hits = [];
  for (const [nStr, entry] of Object.entries(spine.seasons)) {
    const n = Number(nStr);
    const text = [
      ...(entry.beats ?? []).map(b => `${b.label} ${b.text}`),
      entry.cliffhanger?.text ?? '',
      ...(entry.cliffhanger?.questions ?? []),
      ...(entry.characters ?? []).map(c => `${c.name} ${c.line} ${c.note ?? ''}`),
    ].join(' ');

    for (const [laterSeason, terms] of novel) {
      if (laterSeason <= n) continue;
      for (const t of terms) {
        if (new RegExp(`\\b${t}\\b`).test(text)) {
          hits.push({ season: n, from: laterSeason, term: t });
        }
      }
    }
  }
  return hits;
}

// --- stats ------------------------------------------------------------------

function stats(spine) {
  // Names the repair pass already judged not to be people — places, ships,
  // factions. Without this the inspector re-reports Canterbury, Eros and
  // Rocinante as missing character cards on a spine the repair gate calls
  // clean, so the two disagree and neither can be trusted.
  const ignore = new Set(spine.notPeople ?? []);
  const rows = Object.entries(spine.seasons).map(([n, s]) => {
    const beats = s.beats ?? [];
    const lens = beats.map(b => b.text.length);
    return {
      season: n,
      beats: beats.length,
      avg: lens.length ? Math.round(lens.reduce((a, b) => a + b, 0) / lens.length) : 0,
      max: lens.length ? Math.max(...lens) : 0,
      over: lens.filter(l => l > BEAT_CHAR_LIMIT).length,
      chars: s.characters?.length ?? 0,
      questions: s.cliffhanger?.questions?.length ?? 0,
      verify: beats.filter(b => b.needsVerify).length,
      ...coherence(s, ignore),
      // Ordering is enforced downstream in build.ts, but a spine that comes
      // back scrambled is a signal the generation itself was sloppy.
      ordered: beats.every(
        (b, i) => i === 0 || (b.anchorEpisode ?? 99) >= (beats[i - 1].anchorEpisode ?? 99),
      ),
    };
  });

  const all = Object.values(spine.seasons).flatMap(s => s.beats ?? []);
  const lens = all.map(b => b.text.length);
  return {
    rows,
    total: {
      beats: all.length,
      avg: lens.length ? Math.round(lens.reduce((a, b) => a + b, 0) / lens.length) : 0,
      chars: rows.reduce((a, r) => a + r.chars, 0),
      over: rows.reduce((a, r) => a + r.over, 0),
      verify: rows.reduce((a, r) => a + r.verify, 0),
    },
  };
}

function printStats(name, s) {
  console.log(`\n  ${name}`);
  console.log('    season  beats  avg  max  over  cast  Qs  verify  ordered');
  for (const r of s.rows) {
    console.log(
      `    S${r.season.padEnd(6)}${String(r.beats).padEnd(7)}${String(r.avg).padEnd(5)}` +
        `${String(r.max).padEnd(5)}${String(r.over).padEnd(6)}${String(r.chars).padEnd(6)}` +
        `${String(r.questions).padEnd(4)}${String(r.verify).padEnd(8)}${r.ordered ? '✓' : '✗'}`,
    );
    if (r.uncarded?.length)
      console.log(`             ⚠ in beats, no card: ${r.uncarded.slice(0, 4).map(u => `${u.name} (${u.beats})`).join(', ')}`);
    if (r.unused?.length) console.log(`             ⚠ card but not in any beat: ${r.unused.join(', ')}`);
  }
  const t = s.total;
  console.log(
    `    TOTAL   ${String(t.beats).padEnd(7)}${String(t.avg).padEnd(5)}     ` +
      `${String(t.over).padEnd(6)}${String(t.chars).padEnd(6)}    ${t.verify}`,
  );
}

// --- payload size -----------------------------------------------------------

/**
 * What actually reaches a device, versus what we generated.
 *
 * Two whole categories never ship: the Wikipedia plot summaries (input to
 * generation, useless after) and the per-episode stills pools (up to 38 URLs
 * where the composed recap uses one). Worth measuring separately because it is
 * the difference between a feasible payload and an infeasible one at 500 shows.
 */
function shippedSize(data, spine) {
  const stillFor = (season, ep) =>
    data.seasons.find(s => s.season === season)?.episodes.find(e => e.episode === ep)?.still ?? null;

  const payload = {
    slug: data.slug,
    title: data.title,
    overview: data.overview,
    network: data.network,
    poster: data.poster,
    backdrop: data.backdrop,
    totalSeasons: data.totalSeasons,
    seasons: Object.fromEntries(
      Object.entries(spine.seasons).map(([n, s]) => [
        n,
        {
          beats: (s.beats ?? []).map(b => ({
            label: b.label,
            text: b.text,
            image: stillFor(Number(n), b.anchorEpisode),
          })),
          cliffhanger: s.cliffhanger,
          characters: s.characters,
        },
      ]),
    ),
  };
  const raw = Buffer.byteLength(JSON.stringify(payload));
  return { raw, seasons: Object.keys(spine.seasons).length };
}

// --- main -------------------------------------------------------------------

const slug = arg('--slug', 'silo');
const data = await load(`${slug}.json`);
const primary = await load(arg('--spine', `${slug}.spine.json`));
const compare = arg('--compare') ? await load(arg('--compare')) : null;

console.log(`\n▸ ${data.title} — ${data.seasons.length} seasons fetched (through S${data.throughSeason})`);

printStats(arg('--spine', `${slug}.spine.json`), stats(primary));
if (compare) printStats(arg('--compare'), stats(compare));

for (const [label, spine] of [
  [arg('--spine', `${slug}.spine.json`), primary],
  ...(compare ? [[arg('--compare'), compare]] : []),
]) {
  const hits = spoilerScan(data, spine);
  console.log(`\n  spoiler scan — ${label}`);
  if (hits.length === 0) {
    console.log('    ✓ no later-season proper nouns found in earlier seasons');
  } else {
    for (const h of hits) console.log(`    ⚠ S${h.season} mentions "${h.term}" (debuts in S${h.from})`);
  }
}

const size = shippedSize(data, primary);
console.log(
  `\n  shipped payload: ${(size.raw / 1024).toFixed(1)} KB for ${size.seasons} seasons ` +
    `(${(size.raw / size.seasons / 1024).toFixed(1)} KB/season)`,
);
console.log(`  generated data on disk: ${(Buffer.byteLength(JSON.stringify(data)) / 1024).toFixed(1)} KB (not shipped)\n`);
