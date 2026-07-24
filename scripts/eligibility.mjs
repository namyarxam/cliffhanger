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
 * Measured, not guessed, and recalibrated once the set grew past the original
 * twenty. That small set showed a clean gap under Walking Dead (452) with
 * nothing between 250 and 450, which put the bar at 400. At scale the real
 * distribution has two clusters with an empty band between them: genuinely
 * thin articles at 140–339 (Steven Universe 144, The Mandalorian 235) and
 * concise-but-complete ones at 392–398 (Heroes, How I Met Your Mother, Sex and
 * the City) — full episode coverage, just tersely written. The band from 339
 * to 392 is empty, so 375 sits in it: it clears the terse-but-complete shows,
 * whose summaries still run two sentences an episode, and rejects the stubs.
 * Median rather than mean so a couple of rich episodes cannot mask a season of
 * one-liners.
 */
const SEASON_RICHNESS_BAR = 375;

/**
 * Usable episodes above this reject the show for v1.
 *
 * Two limits land on the same number. Quality: whole-show grounding degrades
 * as episode count climbs, and it shows in the audit — The Flash at 184
 * episodes drew 15 high-severity flags, the worst of any show, and The Walking
 * Dead at 177 could not be repaired to clean. A recap that long is also
 * unwieldy as a product; nobody returns to a 200-episode show needing one
 * artefact to cover it. Capacity: the whole-show call cannot hold much more
 * than this, which is why those shows generate badly in the first place.
 *
 * 120 rather than 100 keeps the shows that sit just over — Lost (118),
 * Outlander (101), This Is Us (105) — which are strong recap candidates, while
 * still cutting the genuinely huge ones (Smallville 216, 24 at 204, the
 * CW-verse). A hard reject, not a bound: bounding a long show to its early
 * seasons drops exactly the recent ones a returning viewer came back for.
 */
const EPISODE_CAP = 120;

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

/**
 * A show with more total episodes than this is too big for a v1 recap,
 * regardless of how much of it we cover.
 *
 * This is separate from the USABLE cap. That one counts what we can generate,
 * so a show with sparse Wikipedia coverage slips under it while being enormous:
 * Naruto Shippūden has ~500 episodes, only its first ~32 summarised, so it
 * bounds to 32 usable and passes a cap meant to exclude exactly this kind of
 * show. Judging the WHOLE size catches it — 500 is 500 whether or not we
 * covered it.
 *
 * Deliberately NOT a coverage fraction. Fraction conflates "genuinely huge"
 * (Naruto) with "normal show we happened to under-fetch" (The Wire, 60
 * episodes, bounded to season 1 by a fetcher gap) — and rejecting the latter
 * hides a fetcher bug behind a content rule. Total size is only ever about the
 * show. Set above Lost (121) and below 24 (204), so the marquee long-but-
 * finite shows survive and the hundred-episode sagas do not.
 */
const TOTAL_EPISODE_CAP = 150;

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
  // A hard cap for v1: too large to generate well in one call and too long to
  // recap usefully. See EPISODE_CAP.
  if (usableEpisodes > EPISODE_CAP) {
    reasons.push(
      `${usableEpisodes} usable episodes — over the ${EPISODE_CAP}-episode cap for v1; too large to ground well in one pass`,
    );
  }

  // --- whole-show size ------------------------------------------------------
  //
  // Too big to recap at all for v1, however little of it we hold. Catches the
  // hundred-episode sagas the usable cap misses when their coverage is thin.
  // See TOTAL_EPISODE_CAP.
  if (totalEpisodes > TOTAL_EPISODE_CAP) {
    reasons.push(
      `${totalEpisodes} total episodes — over the ${TOTAL_EPISODE_CAP}-episode show-size cap for v1`,
    );
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
