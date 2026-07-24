#!/usr/bin/env node
/**
 * Offline recap dataset builder.
 *
 * Run once per show, output committed to src/recap/data/. Runtime NEVER calls
 * TMDB — the app reads the generated JSON. That keeps the API key off-device,
 * avoids rate limits in the hot path, and makes the recap deterministic.
 *
 * Show resolution uses the imdb bridge rather than a name search:
 *   TVMaze singlesearch -> externals.imdb -> TMDB /find -> tmdb id
 * An imdb id maps to exactly one entity, so this is exact. Name search is the
 * last-resort fallback and is verified by premiere year before it's accepted.
 *
 * Usage:
 *   node scripts/fetch-recap.mjs --show "Silo" --slug silo --through 2
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bestMatch, tokenOwners } from './name-match.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const IMG = 'https://image.tmdb.org/t/p';
// Everything full-bleed gets `original`.
//
// A 16:9 still shown edge-to-edge on a 9:16 phone has to render ~1515pt wide,
// which at 3x DPR is ~4500px. A w780 source is upscaled 5.8x to get there —
// that was the visible pixelation. Profiles are used the same way (full-bleed
// on character frames), so they need the same treatment; h632 would upscale
// ~4x. We store URLs rather than files, so the only cost is per-view bandwidth,
// and expo-image caches to disk after first load.
const SIZE = { backdrop: 'original', still: 'original', profile: 'original', poster: 'w780' };
const img = (size, path) => (path ? `${IMG}/${size}${path}` : null);

// ---------------------------------------------------------------- env + auth

async function loadEnv() {
  // Deliberately hand-parsed rather than using --env-file, which isn't
  // available on every Node version this repo might be run under.
  const raw = await readFile(resolve(ROOT, '.env'), 'utf8').catch(() => '');
  const env = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

/**
 * TMDB accepts two credential types and they are NOT interchangeable:
 *   - v4 Read Access Token: long JWT, Bearer header only
 *   - v3 API Key: ~32 hex chars, ?api_key= query param only
 * Swapping them yields an opaque 401, so validate the shape up front and say
 * which one we picked.
 */
function resolveAuth(env) {
  const token = env.TMDB_READ_TOKEN?.trim();
  const key = env.TMDB_API_KEY?.trim();

  if (token && token.startsWith('eyJ')) {
    return { mode: 'bearer', headers: { Authorization: `Bearer ${token}` }, query: '' };
  }
  if (token && !token.startsWith('eyJ')) {
    console.warn('⚠️  TMDB_READ_TOKEN is set but does not look like a v4 JWT (expected eyJ...). Ignoring it.');
  }
  if (key && /^[a-f0-9]{32}$/i.test(key)) {
    return { mode: 'api_key', headers: {}, query: `api_key=${key}` };
  }
  if (key) {
    console.warn('⚠️  TMDB_API_KEY is set but is not 32 hex chars — trying it anyway.');
    return { mode: 'api_key(unverified)', headers: {}, query: `api_key=${key}` };
  }
  throw new Error('No TMDB credentials. Set TMDB_READ_TOKEN (preferred) or TMDB_API_KEY in .env');
}

// ---------------------------------------------------------------- http

// Wikipedia's API policy requires a descriptive User-Agent identifying the
// client and a contact address. Requests without one are not merely
// discouraged — they are rate-limited to the point of 429ing under any real
// volume, which is silent here because a failed lookup degrades to the TMDB
// synopsis rather than throwing. The result was every show in a batch coming
// back with 0% plot coverage and being rejected as "thin", when in fact
// nothing had been read at all.
const WIKI_UA = 'CliffhangerRecapBot/1.0 (https://cliffhangerapp.com; cliffhanger.support@gmail.com)';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJSON(url, init, label, attempt = 0) {
  const res = await fetch(url, init);

  // Back off and retry on rate limiting. Grounding quality depends entirely on
  // these lookups landing, so a 429 must not be allowed to degrade quietly
  // into a worse recap.
  if (res.status === 429 && attempt < 4) {
    const wait = Number(res.headers.get('retry-after')) * 1000 || 1500 * 2 ** attempt;
    console.log(`    · ${label} rate-limited, retrying in ${Math.round(wait / 1000)}s`);
    await sleep(wait);
    return getJSON(url, init, label, attempt + 1);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${label} failed ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function makeTmdb(auth) {
  return (path, params = '') => {
    const qs = [auth.query, params].filter(Boolean).join('&');
    const url = `https://api.themoviedb.org/3${path}${qs ? `?${qs}` : ''}`;
    return getJSON(url, { headers: auth.headers }, `TMDB ${path}`);
  };
}

// ---------------------------------------------------------------- resolution

async function resolveShow(tmdb, showName) {
  // Step 1 — TVMaze is the system of record, so start there and read the
  // external ids it already carries.
  const tvmaze = await getJSON(
    `https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(showName)}`,
    {},
    'TVMaze singlesearch',
  );
  const imdb = tvmaze.externals?.imdb;
  const tvdb = tvmaze.externals?.thetvdb;
  console.log(`  TVMaze #${tvmaze.id} "${tvmaze.name}" (${tvmaze.premiered?.slice(0, 4)}) imdb=${imdb ?? '—'} tvdb=${tvdb ?? '—'}`);

  // Step 2 — exact external-id lookups. Read tv_results specifically; /find
  // also returns movie_results and tv_episode_results for the same id.
  for (const [source, id] of [['imdb_id', imdb], ['tvdb_id', tvdb]]) {
    if (!id) continue;
    const found = await tmdb(`/find/${id}`, `external_source=${source}`);
    const hit = found.tv_results?.[0];
    if (hit) {
      console.log(`  ✓ resolved via ${source} → TMDB #${hit.id}`);
      return { tmdbId: hit.id, tvmazeId: tvmaze.id, matchedBy: source };
    }
    console.log(`  · ${source} lookup returned no tv_results, trying next`);
  }

  // Step 3 — fuzzy fallback. Only accepted if the premiere year corroborates,
  // since a name search can silently match a different show entirely.
  const search = await tmdb('/search/tv', `query=${encodeURIComponent(showName)}`);
  const year = Number(tvmaze.premiered?.slice(0, 4));
  const verified = search.results?.find(r => {
    const ry = Number(r.first_air_date?.slice(0, 4));
    return ry && year && Math.abs(ry - year) <= 1;
  });
  if (!verified) throw new Error(`Could not resolve "${showName}" on TMDB (no verified match)`);
  console.log(`  ✓ resolved via verified name search → TMDB #${verified.id}`);
  return { tmdbId: verified.id, tvmazeId: tvmaze.id, matchedBy: 'search+year' };
}

// ---------------------------------------------------------------- wikipedia
//
// Official synopses (TMDB/Apple) are marketing copy: written to entice without
// spoiling, which makes them near-useless as recap ground truth. Compare the
// two sources for Silo S1E10:
//
//   TMDB:      "Juliette's fate seems sealed when certain truths finally come
//               to light."
//   Wikipedia: "...her helmet display shows the same video footage of a lush
//               landscape from the previous cleaning. She realizes the
//               deception... instead of dying, Juliette climbs out of the
//               crater that surrounds the Silo..."
//
// Wikipedia plot summaries are written by viewers with no incentive to withhold
// anything, so they state what actually happened. That's the difference between
// a recap that says "certain truths come to light" and one that tells you what
// the truths were.
//
// SPOILER HAZARD: the article covers EVERY aired season, including ones past
// our boundary. Summaries are therefore bucketed by the section heading they
// appear under and hard-filtered to seasons <= through. Getting this wrong
// leaks future seasons into a recap, which is the worst bug this feature can
// have.

const cleanWiki = s =>
  s
    .replace(/<ref[\s\S]*?<\/ref>/g, '')
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// Rendered-HTML equivalent of cleanWiki: strip reference markers and all tags,
// then decode the entities Wikipedia's HTML uses. Reference superscripts go
// first so their bracketed numbers do not survive as "[14]" in the prose.
const cleanHtml = s =>
  s
    .replace(/<sup[^>]*>[\s\S]*?<\/sup>/g, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#160;|&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\[\d+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Wikipedia's canonical title for a show, resolved by search rather than
 * guessed from the name we hold.
 *
 * The name we get from TMDB is styled for a marquee, not for a URL: TMDB
 * stores "INVINCIBLE", "FROM", "ONE PIECE" in caps, and Wikipedia is
 * case-sensitive after the first character, so "INVINCIBLE season 1" is a
 * missing page while "Invincible season 1" is a 44k-character episode list.
 * That single mismatch reported 0% coverage on shows with complete summaries.
 *
 * Guessing the casing does not work — title-casing fixes "INVINCIBLE" but
 * breaks "BoJack Horseman" into "Bojack". So we ask Wikipedia what it actually
 * calls the article, and strip the "(… TV series)" disambiguator back to a
 * base name that the per-season and list-page patterns can be built from with
 * correct casing. A wrong search hit is caught downstream by the same
 * character-verification gate that guards every other candidate.
 *
 * Returns the base name (disambiguator removed), or null if search finds
 * nothing — in which case the caller falls back to the raw name it was given.
 */
async function resolveWikiTitle(showName, year) {
  const q = year ? `${showName} ${year} television series` : `${showName} television series`;
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json` +
    `&srsearch=${encodeURIComponent(q)}&srlimit=5`;
  const json = await getJSON(url, { headers: { 'User-Agent': WIKI_UA } }, 'Wikipedia search').catch(
    () => null,
  );
  const hits = json?.query?.search ?? [];
  if (!hits.length) return null;

  // Prefer a hit that is plainly a TV article; fall back to the top result.
  const pick =
    hits.find(h => /\((\d{4} )?(American |British )?TV series\)/i.test(h.title)) ?? hits[0];
  // Strip the parenthetical disambiguator: "Invincible (2021 TV series)" and
  // "From (American TV series)" both reduce to the base the patterns need.
  return pick.title.replace(/\s*\((?:\d{4} )?(?:American |British )?TV series\)\s*$/i, '').trim();
}

async function fetchWikipediaSummaries(showName, maxSeason, verify = null) {
  // Longer-running shows split their episodes onto a dedicated list page
  // ("List of The Expanse episodes") and leave the main article with none, so
  // try both shapes. Disambiguated title first — "<Show> (TV series)" avoids
  // landing on an unrelated article for generic show names.
  // Where a show keeps its episode summaries varies, and getting this wrong
  // looks identical to a show with no coverage. Three layouts in the wild:
  //
  //   1. One combined list        "List of <Show> episodes"   (The Expanse)
  //   2. On the main article      "<Show> (TV series)"        (Silo)
  //   3. One article PER SEASON   "<Show> season 1", ...      (most recent
  //                                                            HBO/prestige)
  //
  // Layout 3 is why the first batch run reported 0% coverage for Succession,
  // The Last of Us, House of the Dragon and Andor: their episode tables do
  // not live on any single page, so a combined-page-only search finds nothing
  // and silently falls back to marketing synopses.
  // Year-qualified titles come FIRST when we know the year.
  //
  // Show titles are reused constantly, and Wikipedia disambiguates by year
  // where TMDB disambiguates by id. "Dark Matter (TV series)" is the 2015 Syfy
  // series; the 2024 Apple one is "Dark Matter (2024 TV series)". Without this
  // the fetch resolved the correct show on TMDB — right title, right cast,
  // right stills — and then grounded the entire recap in a different
  // programme's plot.
  const year = verify?.year ?? null;

  // The name Wikipedia actually uses, resolved by search, with the raw name as
  // a fallback. Every pattern below is built from BOTH so a stylized-caps title
  // ("INVINCIBLE") still reaches its correctly-cased article ("Invincible")
  // while a name search-resolution gets wrong is still covered by the original.
  const wikiName = (await resolveWikiTitle(showName, year)) ?? showName;
  const bases = [...new Set([wikiName, showName])];
  if (wikiName !== showName) console.log(`  Wikipedia title resolved: "${showName}" → "${wikiName}"`);

  const candidates = [
    ...bases.flatMap(b => [
      ...(year
        ? [`${b} (${year} TV series)`, `List of ${b} (${year} TV series) episodes`, `${b} (American TV series)`]
        : []),
      `List of ${b} episodes`,
      `${b} (TV series)`,
      b,
      // Per-season articles, merged. Requested regardless of which season the
      // caller asked for, then hard-filtered downstream like every other source.
      // Three real-world spellings: bare ("Invincible season 1"), parenthesised
      // ("The Handmaid's Tale (season 1)"), and British ("Downton Abbey
      // (series 1)"). Each is a different article for a different set of shows,
      // so all three are tried; the combined list above usually wins first and
      // short-circuits them.
      ...Array.from({ length: maxSeason }, (_, i) => `${b} season ${i + 1}`),
      ...Array.from({ length: maxSeason }, (_, i) => `${b} (season ${i + 1})`),
      ...Array.from({ length: maxSeason }, (_, i) => `${b} (series ${i + 1})`),
    ]),
  ];

  const merged = new Map();

  for (const title of candidates) {
    // RENDERED HTML, not raw wikitext.
    //
    // The wikitext of an episode table has no single shape: episodes may be
    // separate {{Episode list/sublist}} calls (Invincible), one transcluded
    // block (Lost), multi-part entries with EpisodeNumber2_1/_2 (Lost's
    // pilot), or {{Episode table}} rows. A regex tuned to one silently returns
    // nothing on the others, which read downstream as "0% coverage" and got
    // Lost, 24, The Handmaid's Tale and Downton Abbey rejected despite full
    // summaries. All of those render to ONE consistent HTML structure:
    // <tr class="vevent …"> carrying the episode numbers, then
    // <td class="description"> carrying the summary. Parsing the rendered
    // output normalises every layout to that structure.
    const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=text&format=json&formatversion=2&redirects=1`;
    const json = await getJSON(url, { headers: { 'User-Agent': WIKI_UA } }, 'Wikipedia parse').catch(() => null);
    const html = json?.parse?.text;
    if (!html || !/class="description"/.test(html)) continue;

    // Is this page actually about the show we resolved?
    //
    // A title match is not identity. This checks that the people TMDB says are
    // in the show actually appear in the prose, which is the cheapest reliable
    // way to catch a same-title mismatch — and the ONLY check that would have
    // caught Dark Matter, whose wrong-show grounding passed every other gate
    // with 100% coverage, 0 needs-verify and a perfectly well-formed spine.
    // Run against the visible text, which is what the summaries are made of.
    const plain = cleanHtml(html);
    if (verify?.characters?.length) {
      const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const present = verify.characters.filter(toks =>
        toks.some(t => new RegExp(`\\b${esc(t)}\\b`, 'i').test(plain)),
      ).length;
      if (present < 2) {
        console.log(`    · "${title}" mentions ${present}/${verify.characters.length} expected characters — wrong show, skipping`);
        continue;
      }
    }

    // Season comes from the title for a per-season/British-series article,
    // whose episode numbering restarts at 1 with no way to tell which season it
    // is from the numbers alone. Combined list pages (pageSeason null) fall back
    // to the resetting-counter logic below — the in-season number dropping is
    // the season boundary, which is sturdier than section headings (The
    // Expanse's list page repeats "Season 1..6" then "Season 1..3").
    const titleSeason = title.match(/[ (](?:season|series)\s+(\d+)\)?$/i);
    const pageSeason = titleSeason ? Number(titleSeason[1]) : null;

    // Walk episode header rows and description cells in document order. A header
    // row (a vevent row that carries the title cell) sets the current in-season
    // number; the next description cell is that episode's summary. Empty vevent
    // spacer rows carry no title cell and are ignored, so they cannot desync
    // the pairing.
    const out = new Map();
    let season = pageSeason ?? 1;
    let prevEp = 0;
    let curEp = null;
    const tokenRe =
      /<tr class="vevent[^"]*"[^>]*>([\s\S]*?)<\/tr>|<td class="description"[^>]*>([\s\S]*?)<\/td>/g;
    for (const m of html.matchAll(tokenRe)) {
      if (m[1] !== undefined) {
        // A header row: take the in-season episode number. The leading numeric
        // cells before the title are [overall] or [overall, in-season]; the
        // last of them is the in-season number that matches TMDB.
        if (!/class="summary"/.test(m[1])) continue;
        const lead = m[1].split(/<td class="summary"/)[0];
        const nums = [...lead.matchAll(/<t[hd][^>]*>\s*(\d+)\s*<\/t[hd]>/g)].map(x => Number(x[1]));
        curEp = nums.length ? nums[nums.length - 1] : null;
      } else if (m[2] !== undefined && curEp != null) {
        // On a per-season page every episode belongs to that season, so the
        // reset heuristic must not fire — a page covering S3 would otherwise
        // relabel its own episodes as S4 partway through.
        if (pageSeason === null && curEp <= prevEp) season += 1;
        prevEp = curEp;
        const ep = curEp;
        curEp = null;
        // The gate. Anything past the boundary never enters the dataset.
        if (season > maxSeason) continue;
        const text = cleanHtml(m[2]);
        if (text.length > 80) out.set(`${season}x${ep}`, text);
      }
    }

    if (out.size > 0) {
      const perSeason = [...out.keys()].reduce((a, k) => {
        const s = k.split('x')[0];
        a[s] = (a[s] ?? 0) + 1;
        return a;
      }, {});
      console.log(
        `  Wikipedia "${title}": ${out.size} summaries ` +
          `(${Object.entries(perSeason).map(([s, n]) => `S${s}:${n}`).join(' ')})`,
      );
      // Merged rather than returned, because per-season layouts spread one
      // show across several pages. First writer wins, so a combined list (tried
      // first, and usually better maintained) is never overwritten by a
      // per-season article covering the same episode.
      for (const [k, v] of out) if (!merged.has(k)) merged.set(k, v);
    }

    // Once every season is covered, the remaining candidates are pointless —
    // stop rather than hammer Wikipedia for pages we will discard. This fires
    // for ANY page type: after the bare "Show season N" pages cover a series
    // there is no reason to also try "(season N)" and "(series N)", which
    // roughly tripled the request count and drew rate-limit errors.
    if (seasonsCovered(merged) >= maxSeason) break;
  }

  if (merged.size === 0) {
    console.warn('  ⚠ no Wikipedia summaries found — falling back to official synopses only');
  } else {
    console.log(`  Wikipedia total: ${merged.size} summaries across ${seasonsCovered(merged)} season(s), seasons 1-${maxSeason} only`);
  }
  return merged;
}

/** How many distinct seasons a summary map covers. */
function seasonsCovered(map) {
  return new Set([...map.keys()].map(k => Number(k.split('x')[0]))).size;
}

// ---------------------------------------------------------------- build

async function build({ showName, slug, through: throughArg }) {
  const env = await loadEnv();
  const auth = resolveAuth(env);
  console.log(`\n▸ Building recap dataset for "${showName}" (through S${throughArg})`);
  console.log(`  auth: ${auth.mode}`);

  const tmdb = makeTmdb(auth);
  const { tmdbId, tvmazeId, matchedBy } = await resolveShow(tmdb, showName);

  const [detail, images, credits, tvmazeCast, tvmazeShow] = await Promise.all([
    tmdb(`/tv/${tmdbId}`),
    tmdb(`/tv/${tmdbId}/images`),
    tmdb(`/tv/${tmdbId}/aggregate_credits`),
    // TVMaze is the only one of the two that distinguishes the CHARACTER from
    // the PERSON. TMDB profiles are actor headshots — often red-carpet or
    // studio portraits with no relation to the role — which on a character card
    // shows you a stranger in a suit instead of the person you're trying to
    // remember. TVMaze character images are in-costume stills from the show.
    // Coverage is partial, so it's a preference, not a replacement.
    getJSON(`https://api.tvmaze.com/shows/${tvmazeId}/cast`, {}, 'TVMaze cast').catch(() => []),
    // Structural signals for eligibility: type ('Scripted' vs Reality/Talk/
    // Documentary), genres (carries 'Anthology'), status ('Ended' vs
    // 'Running'), and runtime. None of this affects the recap's content — it
    // decides whether the show should have one at all.
    getJSON(`https://api.tvmaze.com/shows/${tvmazeId}`, {}, 'TVMaze show').catch(() => null),
  ]);

  // TVMaze in-costume stills, matched to the TMDB roles by name rather than by
  // string equality — the two sources disagree on titles constantly, and an
  // exact lookup silently drops the photo and falls back to a headshot.
  const portraits = tvmazeCast
    .filter(c => c.character?.name && c.character?.image?.original)
    .map(c => ({ name: c.character.name, image: c.character.image.original, weight: 1 }));
  const portraitOwners = tokenOwners(portraits.map(p => p.name));
  const characterImages = new Map();
  for (const c of tvmazeCast) {
    const name = c.character?.name?.toLowerCase();
    const img = c.character?.image?.original;
    if (name && img && !characterImages.has(name)) characterImages.set(name, img);
  }

  // Resolve the boundary now that the real season count is known.
  //
  // 'all' means every aired season and is for building a full dataset. That is
  // safe because the SERVING boundary is enforced per-viewer in the database
  // (recap_max_season), not by what we happen to have fetched. A numeric
  // --through is still honoured and still clamped, for the case where the
  // dataset itself must not contain a season — including when whoever is
  // reviewing the output has not watched that far.
  const through = throughArg === 'all'
    ? detail.number_of_seasons
    : Math.min(Number(throughArg), detail.number_of_seasons);
  if (!Number.isFinite(through) || through < 1) {
    throw new Error(`could not resolve a season range (--through ${throughArg}, show has ${detail.number_of_seasons})`);
  }
  console.log(`  seasons: 1-${through} of ${detail.number_of_seasons}`);

  // Identity check for the Wikipedia lookup: the leading characters TMDB
  // credits, plus the première year. Surnames are used because prose refers to
  // people by surname far more often than by full name.
  // One token-set per top character, for the wrong-show check. Keeping BOTH
  // the given and family name (not just the surname) matters because episode
  // summaries name people however the show does: The Handmaid's Tale's prose is
  // all "June" and "Offred" and almost never "Osborne", so a surname-only check
  // saw zero of its characters and rejected a page with 66 real summaries. A
  // character counts as present if ANY of its name tokens appears.
  const verifyCharacters = (credits.cast ?? [])
    .slice(0, 12)
    .map(c =>
      (c.roles?.[0]?.character ?? '')
        .split(/[\/(]/)[0]
        .split(/\s+/)
        .filter(w => w.length > 3),
    )
    .filter(toks => toks.length)
    .slice(0, 8);

  const wiki = await fetchWikipediaSummaries(detail.name ?? showName, through, {
    characters: verifyCharacters,
    year: (detail.first_air_date ?? '').slice(0, 4) || null,
  });

  // Seasons 1..through only. This is the spoiler boundary and it is enforced
  // HERE, at fetch time — assets past the boundary are never downloaded, so no
  // downstream rendering bug can leak them.
  const seasons = [];
  for (let n = 1; n <= through; n++) {
    const s = await tmdb(`/tv/${tmdbId}/season/${n}`);

    // Pull the FULL still pool per episode, not just the single `still_path`.
    //
    // Several beats can legitimately anchor to the same episode — a finale
    // often carries two beats plus the cliffhanger — and with one image each
    // those frames render identically back to back. TMDB usually holds several
    // stills per episode, so the pool lets consecutive frames pick different
    // ones. Fetched concurrently; failures degrade to the primary still.
    const episodeImages = await Promise.all(
      (s.episodes ?? []).map(e =>
        tmdb(`/tv/${tmdbId}/season/${n}/episode/${e.episode_number}/images`)
          .then(r => (r.stills ?? []).map(x => img(SIZE.still, x.file_path)).filter(Boolean))
          .catch(() => []),
      ),
    );

    seasons.push({
      season: n,
      name: s.name,
      airDate: s.air_date ?? null,
      episodes: (s.episodes ?? []).map((e, i) => {
        const primary = img(SIZE.still, e.still_path);
        // Primary first, then the rest of the pool, deduped.
        const stills = [...new Set([primary, ...(episodeImages[i] ?? [])].filter(Boolean))];
        return {
          episode: e.episode_number,
          name: e.name,
          // Marketing synopsis — kept for reference and as a fallback.
          overview: e.overview,
          // Plot summary. This is the preferred grounding source; see the note
          // above fetchWikipediaSummaries for why.
          plot: wiki.get(`${n}x${e.episode_number}`) ?? null,
          airDate: e.air_date ?? null,
          still: primary,
          stills,
        };
      }),
    });
    const withPlot = (s.episodes ?? []).filter(e => wiki.has(`${n}x${e.episode_number}`)).length;
    console.log(`  S${n}: ${s.episodes?.length ?? 0} episodes, ${s.episodes?.filter(e => e.still_path).length ?? 0} stills, ${withPlot} plot summaries`);
  }

  // Deep enough to cover characters that matter narratively but rank low by
  // episode count — someone pivotal who dies in the premiere, or who only
  // appears in one season, would be missed by a top-20 cut.
  const cast = (credits.cast ?? [])
    .slice(0, 250)
    .map(c => {
      const character = c.roles?.[0]?.character ?? null;
      const inCharacter = character ? bestMatch(character, portraits, portraitOwners)?.image ?? null : null;
      return {
        name: c.name,
        character,
        episodeCount: c.total_episode_count ?? 0,
        // Actor headshot (TMDB).
        profile: img(SIZE.profile, c.profile_path),
        // In-costume still (TVMaze), null when TVMaze has no character image.
        inCharacter,
      };
    })
    // Keep anyone with either image — a character shot alone is still usable.
    .filter(c => c.profile || c.inCharacter);

  const backdrops = (images.backdrops ?? [])
    .filter(b => !b.iso_639_1) // textless renditions — no burned-in titles over our copy
    .slice(0, 12)
    .map(b => img(SIZE.backdrop, b.file_path));

  const data = {
    slug,
    tmdbId,
    tvmazeId,
    matchedBy,
    title: detail.name,
    overview: detail.overview,
    firstAirDate: detail.first_air_date,
    network: detail.networks?.[0]?.name ?? null,
    poster: img(SIZE.poster, detail.poster_path),
    backdrop: img(SIZE.backdrop, detail.backdrop_path),
    backdrops,
    throughSeason: through,
    totalSeasons: detail.number_of_seasons,
    // Recorded, not acted on here. scripts/eligibility.mjs turns these into a
    // verdict; keeping the raw signals means the rules can change without
    // re-fetching every show.
    showType: tvmazeShow?.type ?? null,
    genres: tvmazeShow?.genres ?? [],
    status: tvmazeShow?.status ?? detail.status ?? null,
    runtime: tvmazeShow?.averageRuntime ?? detail.episode_run_time?.[0] ?? null,
    language: tvmazeShow?.language ?? detail.original_language ?? null,
    seasons,
    cast,
    generatedAt: new Date().toISOString(),
  };

  const outDir = resolve(ROOT, 'src/recap/data');
  await mkdir(outDir, { recursive: true });
  const outPath = resolve(outDir, `${slug}.json`);
  await writeFile(outPath, JSON.stringify(data, null, 2));

  const stillCount = seasons.flatMap(s => s.episodes).filter(e => e.still).length;
  const poolCount = seasons.flatMap(s => s.episodes).reduce((a, e) => a + e.stills.length, 0);
  console.log(`\n✓ ${outPath}`);
  const inChar = cast.filter(c => c.inCharacter).length;
  console.log(`  ${backdrops.length} textless backdrops · ${stillCount} episode stills (${poolCount} in pool) · ${cast.length} cast (${inChar} in-character)\n`);
}

// ---------------------------------------------------------------- cli

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};

build({
  showName: arg('show', 'Silo'),
  slug: arg('slug', 'silo'),
  // 'all' is the default for batch work; a number bounds the dataset itself.
  through: arg('through', 'all'),
}).catch(err => {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
});
