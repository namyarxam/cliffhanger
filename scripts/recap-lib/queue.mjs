// The weekly one-look: what the library owes its users, ranked by deadline.
//
// Three lists, all free to compute:
//
//   STALE    — shows whose recap no longer covers every finished season.
//              "Finished" means the season's TVMaze endDate has passed, not
//              that TVMaze lists the season — an announced or mid-air season
//              is not recappable. The ended-show rule from eligibility applies
//              here too: the final season of an ended show is never a target.
//
//   REQUESTS — recap_request_counts(), demand for shows not in the library.
//
//   REPORTS  — open recap_reports, grouped by show.
//
// Staleness re-polls TVMaze per show rather than trusting the total_seasons
// stored at generation time, which is itself stale by definition. For stale
// shows a Wikipedia probe estimates whether the missing seasons are covered
// yet — an ESTIMATE for ranking only (it skips the wrong-show character gate);
// the real gate is eligibility, re-run inside `extend`.
//
// Urgency is the premiere date of the season AFTER the target: the S5 recap's
// deadline is S6's premiere, because that is when a returning viewer opens
// the app needing it.

import { getJSON, WIKI_UA } from './env.mjs';
import { fetchWikipediaSummaries } from './fetch.mjs';

// Same bars as eligibility.mjs. Duplicated knowingly: this is a ranking
// estimate, and importing the full evaluator would demand a full TMDB fetch
// per show for what must stay a free sweep.
const COVERAGE_BAR = 0.8;
const RICHNESS_BAR = 375;

const median = xs => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Run fn with console.log silenced — the wiki fetcher narrates per page. */
async function quietly(fn) {
  const real = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = real;
  }
}

async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await worker(items[idx], idx);
      }
    }),
  );
  return out;
}

/**
 * One show's staleness against TVMaze. Returns null when current.
 */
async function assessShow(row, today) {
  if (!/^\d+$/.test(row.show_id ?? '')) {
    return { slug: row.slug, error: `show_id "${row.show_id}" is not a TVMaze id` };
  }
  let tv;
  try {
    tv = await getJSON(
      `https://api.tvmaze.com/shows/${row.show_id}?embed[]=seasons&embed[]=nextepisode`,
      {},
      `TVMaze ${row.slug}`,
    );
  } catch (e) {
    return { slug: row.slug, error: e.message };
  }

  const seasons = (tv._embedded?.seasons ?? []).filter(s => s.number > 0);
  const maxSeason = Math.max(0, ...seasons.map(s => s.number));
  const finished = seasons.filter(s => s.endDate && s.endDate <= today).map(s => s.number);
  const airedThrough = finished.length ? Math.max(...finished) : 0;

  const ended = /ended/i.test(tv.status ?? '');
  // The final season of an ended show has no next season to prepare for.
  const target = ended && airedThrough === maxSeason ? airedThrough - 1 : airedThrough;

  if (target <= row.through_season) return null;

  // Deadline: when does the season AFTER the target start airing?
  const nextSeason = seasons.find(s => s.number === target + 1);
  const nextEpisode = tv._embedded?.nextepisode?.airdate ?? null;
  const deadline = nextSeason?.premiereDate ?? nextEpisode ?? null;

  const seasonSizes = {};
  for (const s of seasons) if (s.episodeOrder) seasonSizes[s.number] = s.episodeOrder;

  // Character tokens for the wrong-show gate, from TVMaze cast (free, only
  // fetched for stale shows). Without this the probe once counted Dragon Ball
  // Super's summaries as coverage for Ballers — the READY label must carry
  // the same identity check the real fetch does.
  let characters = [];
  try {
    const cast = await getJSON(`https://api.tvmaze.com/shows/${row.show_id}/cast`, {}, `TVMaze cast ${row.slug}`);
    characters = cast
      .slice(0, 12)
      .map(c =>
        (c.character?.name ?? '')
          .split(/[\/(]/)[0]
          .split(/\s+/)
          .filter(w => w.length > 3),
      )
      .filter(toks => toks.length)
      .slice(0, 8);
  } catch {
    /* probe degrades to no identity check; extend still carries the real gate */
  }

  return {
    slug: row.slug,
    title: tv.name ?? row.slug,
    year: (tv.premiered ?? '').slice(0, 4) || null,
    have: row.through_season,
    target,
    missing: Array.from({ length: target - row.through_season }, (_, i) => row.through_season + 1 + i),
    ended,
    deadline,
    seasonSizes,
    characters,
  };
}

/** Wikipedia readiness estimate for a stale show's missing seasons. */
async function probeReadiness(stale) {
  // Caller silences the fetcher's narration around the whole batch — doing it
  // here per-probe under concurrency let a late finisher restore the no-op.
  const wiki = await fetchWikipediaSummaries(stale.title, stale.target, {
    year: stale.year,
    seasonSizes: stale.seasonSizes,
    characters: stale.characters,
  }).catch(() => new Map());

  const perSeason = stale.missing.map(n => {
    const texts = [...wiki.entries()]
      .filter(([k]) => Number(k.split('x')[0]) === n)
      .map(([, v]) => v.length);
    const expected = stale.seasonSizes[n] ?? 0;
    const coverage = expected ? texts.length / expected : 0;
    const rich = median(texts);
    return {
      season: n,
      have: texts.length,
      expected,
      ready: coverage >= COVERAGE_BAR && rich >= RICHNESS_BAR,
    };
  });

  return { ...stale, seasons: perSeason, ready: perSeason.every(s => s.ready) };
}

export async function buildQueue(db, { probe = true } = {}) {
  const today = new Date().toISOString().slice(0, 10);

  const { data: shows, error } = await db
    .from('recap_shows')
    .select('slug, show_id, title, through_season')
    .order('slug');
  if (error) throw new Error(`recap_shows: ${error.message}`);

  console.log(`  polling TVMaze for ${shows.length} shows …`);
  const assessed = await mapLimit(shows, 5, row => assessShow(row, today));
  const errors = assessed.filter(a => a?.error);
  let stale = assessed.filter(a => a && !a.error);

  if (probe && stale.length) {
    console.log(`  probing Wikipedia coverage for ${stale.length} stale show(s) …`);
    stale = await quietly(() => mapLimit(stale, 3, probeReadiness));
  }

  // Soonest deadline first; no-deadline shows sink but stay listed.
  stale.sort((a, b) => (a.deadline ?? '9999') < (b.deadline ?? '9999') ? -1 : 1);

  const { data: requests, error: reqErr } = await db.rpc('recap_request_counts');
  if (reqErr) throw new Error(`recap_request_counts: ${reqErr.message}`);

  const { data: reports, error: repErr } = await db
    .from('recap_reports')
    .select('slug, season, frame_label, reason');
  if (repErr) throw new Error(`recap_reports: ${repErr.message}`);
  const reportsBySlug = {};
  for (const r of reports ?? []) (reportsBySlug[r.slug] ??= []).push(r);

  return { stale, errors, requests: requests ?? [], reportsBySlug };
}

export function printQueue({ stale, errors, requests, reportsBySlug }) {
  const today = new Date().toISOString().slice(0, 10);
  // A deadline slightly in the past is the OPPOSITE of a dead show: the next
  // season premiered while the library lagged, so returning viewers are
  // hitting the gap right now. Only a deadline years past means the coverage
  // has had its chance and stagnated — those were bounded at generation and
  // will not improve; listing them as waiting would cry wolf weekly.
  const staleCutoff = new Date(Date.now() - 400 * 86400e3).toISOString().slice(0, 10);
  const ready = stale.filter(s => s.ready);
  const overdue = stale.filter(
    s => !s.ready && s.deadline && s.deadline < today && s.deadline >= staleCutoff,
  );
  const waiting = stale.filter(s => !s.ready && !(s.deadline && s.deadline < today));
  const unlikely = stale.filter(s => !s.ready && s.deadline && s.deadline < staleCutoff);

  const line = s => {
    const seasons = `S${s.missing.join(',S')}`;
    const cov = (s.seasons ?? [])
      .map(x => `S${x.season}:${x.have}/${x.expected || '?'}ep`)
      .join(' ');
    const when = s.deadline ? `next season ${s.deadline}` : 'no premiere date';
    return `    ${s.slug.padEnd(34)} +${seasons.padEnd(8)} ${cov.padEnd(24)} ${when}${s.ended ? ' · ended' : ''}`;
  };

  if (ready.length) {
    console.log(`\n▸ READY TO EXTEND (${ready.length}) — soonest deadline first`);
    for (const s of ready) console.log(line(s));
    console.log(`\n    node scripts/recap.mjs extend --slug <slug>`);
  }
  if (overdue.length) {
    console.log(
      `\n▸ OVERDUE (${overdue.length}) — the next season already premiered; viewers are hitting this gap NOW. Coverage still short: check whether Wikipedia moved, or whether the probe is missing the article.`,
    );
    for (const s of overdue) console.log(line(s));
  }
  if (waiting.length) {
    console.log(`\n▸ WAITING ON WIKIPEDIA (${waiting.length}) — self-resolves, re-check next week`);
    for (const s of waiting) console.log(line(s));
  }
  if (unlikely.length) {
    console.log(
      `\n▸ BOUNDED AT GENERATION (${unlikely.length}) — next season premiered long ago; coverage has had years to improve and hasn't. Not expected to change.`,
    );
    for (const s of unlikely) console.log(line(s));
  }
  if (!stale.length) console.log('\n▸ no stale shows — every recap covers every finished season');

  if (requests.length) {
    console.log(`\n▸ REQUESTED (${requests.length} shows, not in library)`);
    for (const r of requests.slice(0, 20))
      console.log(`    ${String(r.show_title).padEnd(34)} ${r.requests} request(s) · tvmaze ${r.show_id}`);
  }

  const reported = Object.entries(reportsBySlug);
  if (reported.length) {
    console.log(`\n▸ REPORTED FRAMES (${reported.length} shows)`);
    for (const [slug, list] of reported) {
      console.log(`    ${slug.padEnd(34)} ${list.length} report(s): ${list.map(r => `S${r.season ?? '?'} ${r.frame_label} (${r.reason})`).join('; ')}`);
    }
  }

  if (errors.length) {
    console.log(`\n▸ COULD NOT ASSESS (${errors.length})`);
    for (const e of errors) console.log(`    ${e.slug.padEnd(34)} ${e.error}`);
  }
  console.log('');
}
