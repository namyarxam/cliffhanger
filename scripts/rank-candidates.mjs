#!/usr/bin/env node
/**
 * Rank shows by how much a RECAP would be worth, not by how good they are.
 *
 * WHY NOT JUST TAKE A TOP-250 LIST
 *
 * "Best show" and "show worth recapping" are different questions and they
 * select different titles. A recap earns its place when someone is coming back
 * to a serialised story after a long gap and cannot remember where they left
 * it. That is a specific situation, and three kinds of excellent show do not
 * produce it:
 *
 *   - one-season shows: nothing to recap, ever
 *   - procedurals and anthologies: each season or episode stands alone, so the
 *     gap costs the viewer nothing
 *   - shows nobody is waiting on: a finished series people binge start-to-end
 *     is worth less than a live one with a year between seasons
 *
 * So the ranking is demand × need, where need is about serialisation and
 * return cadence rather than quality. Quality enters only as a popularity
 * proxy, because people track shows they like.
 *
 * WHY TMDB VOTE COUNT AS THE DEMAND SIGNAL
 *
 * The honest signal is how many Cliffhanger users track a show, and at current
 * scale that is a handful of people — using it would encode five accounts'
 * taste as the product's library. TMDB vote count is a large external proxy
 * for the same thing, and it is a COUNT rather than an average, so it measures
 * how many people engaged rather than how much they liked it. Averages rank a
 * beloved obscurity above a show a million people are actually waiting on.
 *
 * Replace this with in-app tracking counts once there are enough users for it
 * to mean something. The metric is the right one; the proxy is temporary.
 *
 * Usage:
 *   node scripts/rank-candidates.mjs --limit 300
 *   node scripts/rank-candidates.mjs --limit 300 --out candidates.json
 */

import { writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const env = Object.fromEntries(
  readFileSync(resolve(ROOT, '.env'), 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const TOKEN = env.TMDB_READ_TOKEN;
if (!TOKEN) {
  console.error('\n✗ TMDB_READ_TOKEN missing from .env\n');
  process.exit(1);
}

const arg = (flag, fallback = null) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const LIMIT = Number(arg('--limit', 300));

/**
 * How many non-English shows to admit, by score, before the list goes
 * English-only.
 *
 * The pipeline grounds on ENGLISH Wikipedia, which is rich for the handful of
 * globally huge non-English hits (Squid Game, Money Heist) and threadbare for
 * everything below them — the richness gate would reject that long tail at
 * fetch time anyway, so ranking it here just pushes real English shows out of
 * view for candidates that will never generate. Keeping a small, hand-checkable
 * top slice captures the ones that genuinely work without letting the tail in.
 */
const NON_ENGLISH_KEEP = Number(arg('--non-english', 10));

// Genres whose shows do not accumulate a story across seasons. Talk, news and
// reality are the obvious ones; Kids is here because children's programming is
// overwhelmingly episodic and its vote counts are inflated by long runs.
const EXCLUDE_GENRES = new Set([10763 /* News */, 10764 /* Reality */, 10767 /* Talk */, 10762 /* Kids */]);

const api = async path => {
  const r = await fetch(`https://api.themoviedb.org/3${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`TMDB ${r.status} on ${path}`);
  return r.json();
};

/** Concurrency-limited map; TMDB tolerates this comfortably. */
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

/**
 * Score a show for recap value.
 *
 * Multiplicative rather than additive: a show that fails on need should not be
 * rescued by demand. A hugely popular procedural still has no recap to give,
 * and summing would put it above a mid-size serialised drama that does.
 */
/**
 * Ask once, for the whole shortlist, how each show is STRUCTURED.
 *
 * This is the part TMDB cannot answer. Nothing in the metadata separates
 * Rick and Morty from Severance: both are recent, well-rated, multi-season,
 * ~10 episodes a season. One of them you can drop into anywhere and one of
 * them is incomprehensible out of order, and that difference is the entire
 * question this ranking exists to answer.
 *
 * Episodes-per-season was the proxy and it fails in both directions — it
 * catches network procedurals at 22 a season and misses every streaming-era
 * episodic comedy at 10.
 *
 * One call for the whole list, on titles alone, because this is recall of a
 * widely-known fact about each show rather than analysis of it.
 */
function askClaude(prompt) {
  return new Promise((res, rej) => {
    const child = spawn('claude', ['-p', '--tools', ''], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('error', rej);
    child.on('close', c => (c === 0 ? res(out) : rej(new Error(`claude exited ${c}: ${err.slice(0, 300)}`))));
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

async function classify(shows) {
  const list = shows.map(s => `  ${s.id}. ${s.title} (${s.year}, ${s.seasons} seasons)`).join('\n');
  const parsed = extractJSON(
    await askClaude(`Classify each TV show by how its story is STRUCTURED across seasons.

${list}

Categories:
- "serial" — the story continues across seasons. Watching season 4 without season 3 leaves you lost. Same characters, one ongoing plot.
- "episodic" — largely self-contained episodes with a loose or slow-moving arc. You can drop in almost anywhere. Most sitcoms, most animated comedies, most case-of-the-week procedurals.
- "anthology" — each season is a SEPARATE STORY WITH A MOSTLY NEW CAST. The people change. Fargo, True Detective, American Horror Story.

The two tests operate at different scales. Apply them in this order:

FIRST, the EPISODE test, which separates episodic from everything else. If a typical EPISODE tells a complete story — a case solved, a patient treated, a rescue completed — the show is "episodic", no matter how much the cast carries over or how much personal-life arc runs underneath. Grey's Anatomy, the Chicago shows, The Rookie, 9-1-1, The Good Doctor, The Blacklist, Supernatural and SEAL Team are all "episodic" by this test: recurring casts with ongoing relationships, but each hour resolves its own story, so a viewer returning after a year has lost nothing they need back.

SECOND, only for shows that pass the episode test, the SEASON test, which separates serial from anthology. Here the question is whether THE CAST AND THEIR HISTORY CARRY OVER, not whether each season has a new plot:

- Same characters facing a new case, mystery, mission or threat each SEASON, where those characters are changed by it, is SERIAL. Only Murders in the Building, Jack Ryan and Star Trek: Picard are serial by this test.
- A show is only anthology if a viewer could start at season 3 having seen nothing, because season 3 is about different people.

Judge by structure, not quality or genre. A comedy with a real season-long arc is "serial"; a prestige drama that resets every week is "episodic". Where a show changed over its run, answer for the majority of its seasons.

Return ONLY valid JSON mapping each numeric id to one category:

{ "kinds": { "${shows[0]?.id}": "serial" } }`),
  );
  return parsed.kinds ?? {};
}

function score(d) {
  // log because vote counts span three orders of magnitude, and the difference
  // between 40,000 and 20,000 votes is not twice the demand.
  const demand = Math.log10(1 + (d.vote_count ?? 0));

  const seasons = d.number_of_seasons ?? 0;
  // 2 seasons is a hard floor — season 1 has nothing before it to recap. Above
  // that the curve is deliberately FLAT.
  //
  // The first version scaled with season count, which got the feature exactly
  // backwards and dropped Severance off the list entirely. Two seasons three
  // years apart is the canonical case this exists for: you finished one, you
  // waited, you remember nothing. A twenty-season soap does not need it twenty
  // times as much — if anything less, since it never stops airing long enough
  // to forget.
  const depth = seasons < 2 ? 0 : 0.75 + 0.25 * Math.min(1, (seasons - 2) / 3);

  // How long since anything aired. A show that ended fifteen years ago has few
  // people mid-way through it waiting on more, however beloved it is.
  //
  // This REPLACES a separate in_production bonus, which was double-counting: a
  // live show necessarily has a recent last_air_date, so it was being rewarded
  // twice and ended shows punished twice. Compounded, that buried Breaking Bad
  // below two hundred other titles, which is a good sign a term is wrong
  // rather than merely strict.
  //
  // The decay is gentle, and floors high, because "nobody is waiting on new
  // episodes" is a much weaker signal than it first appears. People start The
  // Sopranos for the first time every week, take a year off mid-run, and come
  // back needing exactly what this feature provides. A steeper curve dropped
  // both it and The Wire out of the top 200 entirely, which is the wrong
  // answer for a library rather than a merely debatable one.
  const lastAired = Number((d.last_air_date ?? '').slice(0, 4)) || 0;
  const age = lastAired ? new Date().getFullYear() - lastAired : 20;
  const recency = age <= 3 ? 1 : Math.max(0.8, 1 - (age - 3) * 0.015);

  return demand * depth * recency;
}

async function main() {
  console.log('\n  pulling candidates from TMDB …');

  // TWO pools, unioned, because popularity and quality answer different
  // questions and the library needs both.
  //
  // Vote count alone is "what a lot of people watched", which puts Emily in
  // Paris above The Wire — fine as a demand signal, wrong as a library. Rating
  // alone is "what people who finished it thought", which over-weights
  // acclaimed miniseries nobody is waiting on. Taking both and letting the
  // score sort them is cheaper and truer than trying to blend the orderings.
  //
  // Sourced from TMDB rather than an IMDB list because these come back with
  // the ids, season counts and air dates the score needs. Matching an external
  // list by title would cost a fuzzy join and buy a near-identical set.
  const seen = new Set();
  const pool = [];
  const pull = async (path, pages) => {
    for (let page = 1; page <= pages; page++) {
      const d = await api(`${path}${path.includes('?') ? '&' : '?'}page=${page}`);
      for (const s of d.results ?? []) {
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        pool.push(s);
      }
      if (page >= (d.total_pages ?? 1)) break;
    }
  };

  // Pull deep. The cult serials that make a good depth barometer — 12 Monkeys,
  // The Leftovers, The Shield — carry only ~1,000-1,500 votes and sit well
  // below the top few hundred by count, so a shallow pull never sees them.
  // Detail fetches are cheap HTTP and classification is a single call, so the
  // cost of going deep is small and it is the only way these surface at all.
  await pull('/discover/tv?sort_by=vote_count.desc&include_adult=false', 40);
  const before = pool.length;
  // vote_count.gte filters out the handful of 9.5-rated shows with 40 votes,
  // which is what makes a rating sort unusable raw.
  await pull('/discover/tv?sort_by=vote_average.desc&vote_count.gte=300&include_adult=false', 25);
  console.log(`  ${before} by votes + ${pool.length - before} more by rating`);

  const filtered = pool.filter(s => !(s.genre_ids ?? []).some(g => EXCLUDE_GENRES.has(g)));
  console.log(`  ${pool.length} pulled, ${filtered.length} after genre filter — fetching details …`);

  const details = (
    await mapLimit(filtered, 8, async s => {
      try {
        return await api(`/tv/${s.id}`);
      } catch {
        return null;
      }
    })
  ).filter(Boolean);

  const scored = details
    .filter(d => d.type === 'Scripted' && (d.number_of_seasons ?? 0) >= 2)
    .map(d => ({
      id: d.id,
      title: d.name,
      lang: d.original_language,
      year: (d.first_air_date ?? '').slice(0, 4),
      seasons: d.number_of_seasons,
      episodes: d.number_of_episodes,
      votes: d.vote_count,
      live: !!d.in_production,
      status: d.status,
      score: score(d),
    }))
    .sort((a, b) => b.score - a.score);

  // Classify a generous slice rather than the whole pool: everything below it
  // is out on demand alone, so paying to learn its structure buys nothing.
  const shortlist = scored.slice(0, LIMIT * 2);
  console.log(`  classifying structure for top ${shortlist.length} …`);
  const kinds = await classify(shortlist);

  const dropped = { episodic: [], anthology: [] };
  const serial = shortlist
    .map(s => ({ ...s, kind: kinds[String(s.id)] ?? 'unknown' }))
    .filter(s => {
      if (s.kind === 'episodic' || s.kind === 'anthology') {
        dropped[s.kind].push(s.title);
        return false;
      }
      return true;
    });

  // English-only, plus the top NON_ENGLISH_KEEP non-English shows by score.
  // Both slices are already score-sorted; concatenating and re-sorting keeps
  // one clean ranking while enforcing the cap on the non-English side.
  const english = serial.filter(s => s.lang === 'en');
  const nonEnglishKept = serial.filter(s => s.lang !== 'en').slice(0, NON_ENGLISH_KEEP);
  const nonEnglishCut = serial.filter(s => s.lang !== 'en').slice(NON_ENGLISH_KEEP);
  const ranked = [...english, ...nonEnglishKept]
    .sort((a, b) => b.score - a.score)
    .slice(0, LIMIT);

  console.log(
    `\n  kept ${nonEnglishKept.length} non-English: ${nonEnglishKept.map(s => s.title).join(', ')}`,
  );
  console.log(`  set aside ${nonEnglishCut.length} more non-English (English Wikipedia too thin to ground)`);

  for (const k of ['episodic', 'anthology']) {
    // Named, not just counted. A silent filter that removes a third of the
    // pool reads as "these shows were not popular enough", which is a
    // different and wrong conclusion.
    console.log(`\n  dropped ${dropped[k].length} ${k}: ${dropped[k].slice(0, 24).join(', ')}${dropped[k].length > 24 ? ' …' : ''}`);
  }

  const out = arg('--out');
  if (out) {
    await writeFile(resolve(ROOT, out), JSON.stringify(ranked, null, 2));
    // Everything considered, with its verdict, so "why isn't X here" has an
    // answer. Absence has three quite different causes — never pulled, gated
    // out on structure, or simply outscored — and they call for different
    // fixes. Without this the only way to tell them apart is to guess.
    await writeFile(
      resolve(ROOT, out.replace(/\.json$/, '.debug.json')),
      JSON.stringify(
        scored.map(s => ({ ...s, kind: kinds[String(s.id)] ?? 'not-classified' })),
        null,
        2,
      ),
    );
    console.log(`\n  wrote ${ranked.length} → ${out} (+ .debug.json with all ${scored.length} considered)`);
  }

  console.log('');
  ranked.forEach((r, i) => {
    console.log(
      `${String(i + 1).padStart(4)}. ${r.title.slice(0, 34).padEnd(35)} ${String(r.year).padEnd(5)} ` +
        `${String(r.seasons).padStart(2)}S ${String(r.votes).padStart(6)}v ${r.live ? 'live' : '    '} ${r.score.toFixed(2)}`,
    );
  });
  console.log('');
}

main().catch(e => {
  console.error(`\n✗ ${e.message}\n`);
  process.exit(1);
});
