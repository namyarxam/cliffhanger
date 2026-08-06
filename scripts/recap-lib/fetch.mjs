// Facts: episodes, synopses, images — TVMaze + TMDB + Wikipedia.
//
// Ported from the retired scripts/fetch-recap.mjs with its behaviour intact;
// the differences are that it returns the dataset in memory (the next stage
// never reads it back off disk) and that a parsed-but-unattached summary set
// is a thrown error rather than an exit code. Everything else — the imdb
// bridge, the Wikipedia layout hunt, the wrong-show character check, the
// overall-numbering rebase — is the accumulated bug-fix record of the first
// library build and is kept verbatim.
//
// SPOILER HAZARD: Wikipedia covers EVERY aired season. Summaries are bucketed
// by season and hard-filtered to seasons <= through at parse time, so assets
// past the boundary never enter the dataset.

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { WORK, WIKI_UA, getJSON, makeTmdb, resolveTmdbAuth } from './env.mjs';
import { bestMatch, tokenOwners } from './name-match.mjs';

const IMG = 'https://image.tmdb.org/t/p';
// Everything full-bleed gets `original`: a 16:9 still shown edge-to-edge on a
// 9:16 phone renders ~4500px at 3x DPR, and w780 upscaled 5.8x was visibly
// pixelated. URLs are stored, not files, so the only cost is per-view
// bandwidth, and expo-image caches to disk.
const SIZE = { backdrop: 'original', still: 'original', profile: 'original', poster: 'w780' };
const img = (size, path) => (path ? `${IMG}/${size}${path}` : null);

// ---------------------------------------------------------------- resolution

async function resolveShow(tmdb, showName) {
  // TVMaze is the system of record; start there and read its external ids.
  const tvmaze = await getJSON(
    `https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(showName)}`,
    {},
    'TVMaze singlesearch',
  );
  const imdb = tvmaze.externals?.imdb;
  const tvdb = tvmaze.externals?.thetvdb;
  console.log(
    `  TVMaze #${tvmaze.id} "${tvmaze.name}" (${tvmaze.premiered?.slice(0, 4)}) imdb=${imdb ?? '—'} tvdb=${tvdb ?? '—'}`,
  );

  // Exact external-id lookups. An imdb id maps to exactly one entity.
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

  // Fuzzy fallback, accepted only when the premiere year corroborates — a name
  // search can silently match a different show entirely.
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
// Official synopses are marketing copy — written to entice without spoiling,
// which makes them near-useless as recap ground truth. Wikipedia plot
// summaries state what actually happened, so they are the preferred source.

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
 * guessed. TMDB stores marquee styling ("INVINCIBLE") and Wikipedia is
 * case-sensitive after the first character; title-casing fixes one show and
 * breaks another ("BoJack" → "Bojack"), so ask Wikipedia what it calls the
 * article. A wrong hit is caught downstream by the character-verification gate.
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
  const pick =
    hits.find(h => /\((\d{4} )?(American |British )?TV series\)/i.test(h.title)) ?? hits[0];
  return pick.title.replace(/\s*\((?:\d{4} )?(?:American |British )?TV series\)\s*$/i, '').trim();
}

export async function fetchWikipediaSummaries(showName, maxSeason, verify = null) {
  // Where a show keeps its episode summaries varies, and getting this wrong
  // looks identical to a show with no coverage. Three layouts in the wild:
  //   1. One combined list        "List of <Show> episodes"
  //   2. On the main article      "<Show> (TV series)"
  //   3. One article PER SEASON   "<Show> season 1", ...
  // Year-qualified titles come FIRST when the year is known, because show
  // titles are reused constantly and Wikipedia disambiguates by year.
  const year = verify?.year ?? null;
  const wikiName = (await resolveWikiTitle(showName, year)) ?? showName;
  const bases = [...new Set([wikiName, showName])];
  if (wikiName !== showName)
    console.log(`  Wikipedia title resolved: "${showName}" → "${wikiName}"`);

  const candidates = [
    ...bases.flatMap(b => [
      ...(year
        ? [`${b} (${year} TV series)`, `List of ${b} (${year} TV series) episodes`, `${b} (American TV series)`]
        : []),
      `List of ${b} episodes`,
      `${b} (TV series)`,
      b,
      // Per-season articles in their three real-world spellings. The combined
      // list above usually wins first and short-circuits them.
      ...Array.from({ length: maxSeason }, (_, i) => `${b} season ${i + 1}`),
      ...Array.from({ length: maxSeason }, (_, i) => `${b} (season ${i + 1})`),
      ...Array.from({ length: maxSeason }, (_, i) => `${b} (series ${i + 1})`),
    ]),
  ];

  const merged = new Map();

  for (const title of candidates) {
    // RENDERED HTML, not raw wikitext: episode tables have no single wikitext
    // shape, but all of them render to <tr class="vevent"> rows and
    // <td class="description"> cells.
    const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=text&format=json&formatversion=2&redirects=1`;
    const json = await getJSON(url, { headers: { 'User-Agent': WIKI_UA } }, 'Wikipedia parse').catch(() => null);
    const html = json?.parse?.text;
    if (!html || !/class="description"/.test(html)) continue;

    // Is this page actually about the show we resolved? A title match is not
    // identity — this character check is the ONLY gate that catches a
    // same-title different-show article, which once grounded an entire recap
    // in another programme's plot.
    const plain = cleanHtml(html);
    if (verify?.characters?.length) {
      const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const present = verify.characters.filter(toks =>
        toks.some(t => new RegExp(`\\b${esc(t)}\\b`, 'i').test(plain)),
      ).length;
      if (present < 2) {
        console.log(
          `    · "${title}" mentions ${present}/${verify.characters.length} expected characters — wrong show, skipping`,
        );
        continue;
      }
    }

    // Season number: from the title for a per-season article; from the
    // resetting in-season episode counter for a combined list.
    const titleSeason = title.match(/[ (](?:season|series)\s+(\d+)\)?$/i);
    const pageSeason = titleSeason ? Number(titleSeason[1]) : null;

    const rows = [];
    let season = pageSeason ?? 1;
    let prevEp = 0;
    let curEp = null;
    const tokenRe =
      /<tr class="vevent[^"]*"[^>]*>([\s\S]*?)<\/tr>|<td class="description"[^>]*>([\s\S]*?)<\/td>/g;
    for (const m of html.matchAll(tokenRe)) {
      if (m[1] !== undefined) {
        if (!/class="summary"/.test(m[1])) continue;
        const lead = m[1].split(/<td class="summary"/)[0];
        const nums = [...lead.matchAll(/<t[hd][^>]*>\s*(\d+)\s*<\/t[hd]>/g)].map(x => Number(x[1]));
        curEp = nums.length ? nums[nums.length - 1] : null;
      } else if (m[2] !== undefined && curEp != null) {
        // On a per-season page every episode belongs to that season; the reset
        // heuristic must not fire there.
        if (pageSeason === null && curEp <= prevEp) season += 1;
        prevEp = curEp;
        const ep = curEp;
        curEp = null;
        const text = cleanHtml(m[2]);
        if (text.length > 80) rows.push({ season, ep, text });
      }
    }

    // Overall-numbering rebase (Broadchurch S2 numbers 9-16 where TMDB says
    // 1-8). Fires only on the full pattern of a continued overall count:
    // every episode present, contiguous, starting exactly where the prior
    // seasons left off. Anything looser risks filing summaries under the
    // wrong episodes, which is worse than a season with no text at all.
    const expected = verify?.seasonSizes?.[pageSeason];
    const priorEpisodes = pageSeason
      ? Object.entries(verify?.seasonSizes ?? {})
          .filter(([n]) => Number(n) < pageSeason)
          .reduce((a, [, size]) => a + size, 0)
      : 0;
    if (pageSeason !== null && expected && rows.length === expected && rows[0].ep > 1) {
      const contiguous = rows.every((r, i) => i === 0 || r.ep === rows[i - 1].ep + 1);
      const offset = rows[0].ep - 1;
      if (contiguous && offset === priorEpisodes) {
        console.log(
          `    · "${title}" numbers episodes ${rows[0].ep}-${rows[rows.length - 1].ep} (overall) — rebased to 1-${rows.length}`,
        );
        for (const r of rows) r.ep -= offset;
      }
    }

    const out = new Map();
    for (const r of rows) {
      // The spoiler gate. Anything past the boundary never enters the dataset.
      if (r.season > maxSeason) continue;
      out.set(`${r.season}x${r.ep}`, r.text);
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
      // First writer wins: a combined list (tried first, usually better
      // maintained) is never overwritten by a per-season article.
      for (const [k, v] of out) if (!merged.has(k)) merged.set(k, v);
    }

    // Stop once EVERY season is genuinely covered against its expected episode
    // count — not merely touched. Averaging would let one rich season mask
    // four thin ones.
    const per = {};
    for (const k of merged.keys()) {
      const s = Number(k.split('x')[0]);
      per[s] = (per[s] ?? 0) + 1;
    }
    let complete = true;
    for (let s = 1; s <= maxSeason; s++) {
      const want = verify?.seasonSizes?.[s] ?? 0;
      const have = per[s] ?? 0;
      if (want ? have < want * 0.8 : have < 6) {
        complete = false;
        break;
      }
    }
    if (complete) break;
  }

  if (merged.size === 0) {
    console.warn('  ⚠ no Wikipedia summaries found — eligibility will reject or bound this show');
  } else {
    const seasonsCovered = new Set([...merged.keys()].map(k => Number(k.split('x')[0]))).size;
    console.log(
      `  Wikipedia total: ${merged.size} summaries across ${seasonsCovered} season(s), seasons 1-${maxSeason} only`,
    );
  }
  return merged;
}

// ---------------------------------------------------------------- build

/**
 * Fetch everything a recap needs for one show. Returns the dataset and writes
 * a debug copy to scripts/recap-work/<slug>.json.
 *
 * `through: 'all'` fetches every aired season, which is safe because the
 * SERVING boundary is enforced per-viewer in the database (recap_max_season) —
 * eligibility then bounds what actually gets generated.
 */
export async function fetchShow({ showName, slug, through: throughArg = 'all' }, env) {
  const auth = resolveTmdbAuth(env);
  console.log(`\n▸ Fetching "${showName}" (through ${throughArg === 'all' ? 'all seasons' : `S${throughArg}`})`);
  console.log(`  TMDB auth: ${auth.mode}`);

  const tmdb = makeTmdb(auth);
  const { tmdbId, tvmazeId, matchedBy } = await resolveShow(tmdb, showName);

  const [detail, images, credits, tvmazeCast, tvmazeShow] = await Promise.all([
    tmdb(`/tv/${tmdbId}`),
    tmdb(`/tv/${tmdbId}/images`),
    tmdb(`/tv/${tmdbId}/aggregate_credits`),
    // TVMaze is the only source distinguishing the CHARACTER from the PERSON:
    // its character images are in-costume stills, where TMDB profiles are
    // red-carpet headshots. Partial coverage, so a preference not a replacement.
    getJSON(`https://api.tvmaze.com/shows/${tvmazeId}/cast`, {}, 'TVMaze cast').catch(() => []),
    // Structural signals for eligibility (type, genres, status, runtime).
    getJSON(`https://api.tvmaze.com/shows/${tvmazeId}`, {}, 'TVMaze show').catch(() => null),
  ]);

  // TVMaze in-costume stills, matched to TMDB roles by the shared name
  // matcher — the two sources disagree on titles constantly.
  const portraits = tvmazeCast
    .filter(c => c.character?.name && c.character?.image?.original)
    .map(c => ({ name: c.character.name, image: c.character.image.original, weight: 1 }));
  const portraitOwners = tokenOwners(portraits.map(p => p.name));

  const through =
    throughArg === 'all'
      ? detail.number_of_seasons
      : Math.min(Number(throughArg), detail.number_of_seasons);
  if (!Number.isFinite(through) || through < 1) {
    throw new Error(
      `could not resolve a season range (through=${throughArg}, show has ${detail.number_of_seasons})`,
    );
  }
  console.log(`  seasons: 1-${through} of ${detail.number_of_seasons}`);

  // Identity tokens for the wrong-show check. Both given and family names are
  // kept because prose names people however the show does ("June", not
  // "Osborne").
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

  const seasonSizes = {};
  for (const s of detail.seasons ?? []) {
    if (s.season_number > 0) seasonSizes[s.season_number] = s.episode_count ?? 0;
  }

  const wiki = await fetchWikipediaSummaries(detail.name ?? showName, through, {
    characters: verifyCharacters,
    year: (detail.first_air_date ?? '').slice(0, 4) || null,
    seasonSizes,
  });

  const seasons = [];
  for (let n = 1; n <= through; n++) {
    const s = await tmdb(`/tv/${tmdbId}/season/${n}`);

    // Full still POOL per episode, not just still_path: a finale routinely
    // carries two beats plus the cliffhanger, and with one image each those
    // frames render identically back to back.
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
        const stills = [...new Set([primary, ...(episodeImages[i] ?? [])].filter(Boolean))];
        return {
          episode: e.episode_number,
          name: e.name,
          overview: e.overview, // marketing synopsis — reference and fallback
          plot: wiki.get(`${n}x${e.episode_number}`) ?? null, // preferred grounding
          airDate: e.air_date ?? null,
          still: primary,
          stills,
        };
      }),
    });
    const withPlot = (s.episodes ?? []).filter(e => wiki.has(`${n}x${e.episode_number}`)).length;
    console.log(
      `  S${n}: ${s.episodes?.length ?? 0} episodes, ${s.episodes?.filter(e => e.still_path).length ?? 0} stills, ${withPlot} plot summaries`,
    );
  }

  // Deep cast cut so narratively-vital minor characters survive.
  const cast = (credits.cast ?? [])
    .slice(0, 250)
    .map(c => {
      const character = c.roles?.[0]?.character ?? null;
      const inCharacter = character
        ? bestMatch(character, portraits, portraitOwners)?.image ?? null
        : null;
      return {
        name: c.name,
        character,
        episodeCount: c.total_episode_count ?? 0,
        profile: img(SIZE.profile, c.profile_path),
        inCharacter,
      };
    })
    .filter(c => c.profile || c.inCharacter);

  const backdrops = (images.backdrops ?? [])
    .filter(b => !b.iso_639_1) // textless — no burned-in titles under our copy
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
    showType: tvmazeShow?.type ?? null,
    genres: tvmazeShow?.genres ?? [],
    status: tvmazeShow?.status ?? detail.status ?? null,
    runtime: tvmazeShow?.averageRuntime ?? detail.episode_run_time?.[0] ?? null,
    language: tvmazeShow?.language ?? detail.original_language ?? null,
    seasons,
    cast,
    generatedAt: new Date().toISOString(),
  };

  // Did the summaries we parsed actually LAND on episodes? A season Wikipedia
  // never covered is fine (that's the lag this pipeline works around); a
  // season Wikipedia DID cover that failed to attach is always a bug here,
  // and downstream it is indistinguishable from a show with fewer seasons —
  // so it is a hard failure, not a warning.
  const mismatched = [];
  for (const s of seasons) {
    const claimed = [...wiki.keys()].filter(k => Number(k.split('x')[0]) === s.season).length;
    const attached = s.episodes.filter(e => e.plot).length;
    if (claimed > 0 && attached < claimed * 0.8) mismatched.push({ season: s.season, claimed, attached });
  }
  if (mismatched.length) {
    const detail = mismatched
      .map(m => {
        const got = [...wiki.keys()]
          .filter(k => Number(k.split('x')[0]) === m.season)
          .map(k => k.split('x')[1]);
        const tm = seasons.find(s => s.season === m.season).episodes.map(e => e.episode);
        return `S${m.season}: parsed ${m.claimed}, attached ${m.attached} (wiki eps ${got.join(',')} vs TMDB eps ${tm.join(',')})`;
      })
      .join('\n  ');
    throw new Error(`episode-key mismatch — summaries parsed but did not attach:\n  ${detail}`);
  }

  await mkdir(WORK, { recursive: true });
  const outPath = resolve(WORK, `${slug}.json`);
  await writeFile(outPath, JSON.stringify(data, null, 2));
  const inChar = cast.filter(c => c.inCharacter).length;
  console.log(
    `  ✓ dataset: ${backdrops.length} backdrops · ${cast.length} cast (${inChar} in-character) · debug copy ${outPath}`,
  );

  return data;
}
