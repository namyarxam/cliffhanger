// Should this show have a recap, and how far can we honestly take it?
//
// Separate from fetching so the rules can change without re-downloading, and
// separate from generation because the answer is usually knowable before
// spending a call.
//
// The bar is not "is this a good show". It is: does a returning viewer have
// something to be reminded OF, and is there a next season to be reminded FOR.
// Both halves matter. A brilliant miniseries fails the second; a per-episode
// anthology fails the first.

/** A season needs this share of its episodes summarised to be generated. */
const SEASON_COVERAGE_BAR = 0.8;

/**
 * A season's episode summaries need this MEDIAN length, in characters, to
 * ground a recap.
 *
 * Coverage counts presence, not substance: an episode with 85 characters of
 * plot passes the coverage bar identically to one with 1,100, and a stub
 * article — one line per episode — can clear 80% coverage while saying almost
 * nothing. That is the exact failure mode for non-English shows, whose English
 * Wikipedia articles are often present but threadbare, and a thin summary does
 * not produce a thin recap, it produces a confident wrong one from the model's
 * own memory.
 *
 * Measured, not guessed. Across the validation set the thinnest legitimate
 * season medians 452 characters (The Walking Dead, an eleven-season show on a
 * cramped list page); everything else sits 550–1,280. A stub row is 150–250.
 * 400 falls in the empty gap between them — below every real show with margin,
 * far above any stub. Median rather than mean so a couple of rich episodes
 * cannot mask a season of one-liners.
 */
const SEASON_RICHNESS_BAR = 400;

const median = xs => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Cast continuity below this means episodes share no characters — a
 * per-episode anthology, which has no spine to build.
 *
 * Measured, not guessed. Across the validation set: Black Mirror 6%, Fargo
 * 24%, The White Lotus 67%, and every continuous show 100%. The gap between
 * an episode anthology and a season anthology is wide and unambiguous.
 */
const EPISODE_ANTHOLOGY = 0.15;

/**
 * Below this, seasons tell separate stories — an anthology, and a rejection.
 *
 * Season anthologies are not a degraded case of the feature, they are outside
 * it. The trigger a recap exists for is "the new season is imminent and I have
 * forgotten the old one", and for Fargo or The White Lotus there is nothing to
 * have forgotten: the next season is a different story with different people.
 * A per-season recap would be well-formed and pointless.
 *
 * Threshold measured across the validation set, where the gap is unambiguous:
 * Black Mirror 6%, Fargo 24%, The White Lotus 67%, and every continuous show
 * 100%. Nothing lands in between, so 75% separates cleanly with room on both
 * sides. Worth revisiting if a legitimate show with a genuinely rotating
 * ensemble ever falls below it — the failure mode is a show wrongly skipped,
 * which is visible and recoverable, rather than a bad recap shipped.
 */
const ANTHOLOGY = 0.75;

export function evaluate(data) {
  const reasons = [];
  const warnings = [];

  const perSeason = data.seasons.map(s => {
    const total = s.episodes.length;
    const summarised = s.episodes.filter(e => e.plot && e.plot.length > 80);
    const withPlot = summarised.length;
    return {
      season: s.season,
      total,
      withPlot,
      coverage: total ? withPlot / total : 0,
      richness: median(summarised.map(e => e.plot.length)),
    };
  });

  /**
   * How far the recap can honestly go.
   *
   * Contiguous from season 1, because a gap cannot be skipped — season 4 makes
   * no sense to someone who was never told what happened in season 3.
   *
   * Thin coverage is almost always the CURRENTLY AIRING season, where
   * Wikipedia lags broadcast: Hacks is complete through season 3 and empty for
   * 4 and 5; Squid Game is complete through 2 with one episode of 3. That is
   * exactly the season nobody needs a recap for yet — you recap seasons you
   * have finished, and the thin one is the one still going out. So a show like
   * this is not rejected, it is bounded.
   */
  let usableThrough = 0;
  for (const s of perSeason) {
    const good = s.coverage >= SEASON_COVERAGE_BAR && s.richness >= SEASON_RICHNESS_BAR;
    if (s.season === usableThrough + 1 && good) usableThrough = s.season;
    else break;
  }

  const totalEpisodes = perSeason.reduce((a, s) => a + s.total, 0);
  const usableEpisodes = perSeason
    .filter(s => s.season <= usableThrough)
    .reduce((a, s) => a + s.total, 0);
  const coverage = totalEpisodes
    ? perSeason.reduce((a, s) => a + s.withPlot, 0) / totalEpisodes
    : 0;

  // --- is there a next season to come back to ----------------------------
  //
  // A recap's trigger is "the new season is imminent and I have forgotten the
  // old ones". A finished one-season show has no trigger, so the recap would
  // never be opened at the moment it is useful. This rejects miniseries
  // without needing a miniseries flag, which TVMaze does not have.
  if (data.totalSeasons <= 1 && /ended|to be determined/i.test(data.status ?? '')) {
    reasons.push('single season and ended — no next season to recap for');
  }

  // --- is there a thread --------------------------------------------------
  //
  // Detected by cast continuity, NOT by genre. TVMaze tags none of Black
  // Mirror, Fargo or The White Lotus as 'Anthology', so a genre gate silently
  // passes every one of them — the first version of this rule did exactly
  // that and let Black Mirror through.
  const topBilling = Math.max(0, ...data.cast.map(c => c.episodeCount ?? 0));
  // Capped at 1. TMDB reports episode counts across a show's whole run while
  // totalEpisodes reflects only the seasons fetched, so a dataset bounded by
  // --through reads above 100% (The Expanse 135%, Silo 150%). Harmless — it can
  // only inflate, never falsely reject — but it should not look like a number.
  const continuity = totalEpisodes ? Math.min(1, topBilling / totalEpisodes) : 0;
  if (continuity < EPISODE_ANTHOLOGY) {
    reasons.push(
      `per-episode anthology — no recurring cast (top billing appears in ${topBilling}/${totalEpisodes} episodes)`,
    );
  } else if (continuity < ANTHOLOGY) {
    reasons.push(
      `anthology — each season is a separate story (cast continuity ${Math.round(continuity * 100)}%), so an earlier season is not preparation for the next`,
    );
  }

  // --- is it the right kind of programme ----------------------------------
  if (data.showType && !['Scripted', 'Animation'].includes(data.showType)) {
    reasons.push(`show type is ${data.showType}, not Scripted`);
  }

  // --- can we actually write it -------------------------------------------
  //
  // Thin summaries do not produce a thin recap; they produce a confident wrong
  // one, because the model fills the gaps from memory. This is the strongest
  // predictor of a bad recap and it is knowable before spending a call.
  if (usableThrough === 0) {
    const s1 = perSeason[0];
    // Name whichever bar S1 actually missed. A stub article fails on richness
    // while reading 100% coverage, and reporting only coverage there sends
    // someone hunting for missing episodes that are all present.
    const cov = Math.round((s1?.coverage ?? 0) * 100);
    const rich = Math.round(s1?.richness ?? 0);
    if ((s1?.coverage ?? 0) < SEASON_COVERAGE_BAR) {
      reasons.push(`season 1 coverage ${cov}% (need ${SEASON_COVERAGE_BAR * 100}%)`);
    } else {
      reasons.push(
        `season 1 summaries too thin — median ${rich} chars (need ${SEASON_RICHNESS_BAR}); article is present but not detailed enough to ground a recap`,
      );
    }
  } else if (usableThrough < data.seasons.length) {
    const dropped = perSeason
      .filter(s => s.season > usableThrough)
      .map(s => `S${s.season} ${s.withPlot}/${s.total}ep ${Math.round(s.richness)}ch`)
      .join(', ');
    warnings.push(`bounded to S1-S${usableThrough}; thin beyond: ${dropped}`);
  }

  // --- scale ---------------------------------------------------------------
  //
  // Not a rejection. A show this size cannot go through whole-show generation
  // in one call and needs chunking into season groups.
  if (usableEpisodes > 120) {
    warnings.push(`${usableEpisodes} episodes — too large for a single whole-show call, needs chunking`);
  }

  // Comedy is NOT auto-rejected. Sitcoms genuinely do not need recaps, but
  // serialised comedy (The Bear, Hacks) does, and runtime plus genre cannot
  // tell them apart. Flagged for a human rather than guessed at.
  if (data.genres?.includes('Comedy') && (data.runtime ?? 60) <= 35) {
    warnings.push('short-form comedy — confirm it is serialised enough to be worth recapping');
  }

  return {
    ok: reasons.length === 0 && usableThrough > 0,
    usableThrough,
    reasons,
    warnings,
    perSeason,
    stats: { totalEpisodes, usableEpisodes, coverage, continuity, seasons: data.seasons.length },
  };
}
