// Should this show have a recap at all?
//
// Separate from fetching so the rules can change without re-downloading
// anything, and separate from generation because the answer is usually
// knowable before spending a call.
//
// The bar is not "is this a good show". It is: does a returning viewer have
// something to be reminded OF, and is there a next season to be reminded FOR.
// Both halves matter. A brilliant miniseries fails the second; a per-episode
// anthology fails the first.

/** Reasons a show is rejected, most decisive first. */
export function evaluate(data) {
  const reasons = [];
  const warnings = [];

  const totalEpisodes = data.seasons.reduce((a, s) => a + s.episodes.length, 0);
  const withPlot = data.seasons.reduce(
    (a, s) => a + s.episodes.filter(e => e.plot && e.plot.length > 80).length,
    0,
  );
  const coverage = totalEpisodes ? withPlot / totalEpisodes : 0;

  // --- has a next season to come back to ---------------------------------
  //
  // A recap's trigger is "the new season is imminent and I've forgotten the
  // old ones". A finished one-season show has no trigger — there is nothing
  // to come back to, so the recap would never be opened at the moment it is
  // useful. This is what rejects miniseries without needing a miniseries flag,
  // which TVMaze does not have.
  if (data.totalSeasons <= 1 && /ended|to be determined/i.test(data.status ?? '')) {
    reasons.push('single season and ended — no next season to recap for');
  }

  // --- is there a thread ---------------------------------------------------
  //
  // Per-episode anthologies (Black Mirror) share no characters or plot between
  // episodes, so there is no spine to build. Detected by cast continuity
  // rather than by the 'Anthology' genre, because that genre also covers
  // SEASON anthologies like Fargo, where each season is internally continuous
  // and a per-season recap works fine.
  //
  // Signal: the most-recurring cast member's episode count against the total.
  // A continuous show has a lead in most episodes; an episode anthology has
  // nobody above a couple.
  const topBilling = Math.max(0, ...data.cast.map(c => c.episodeCount ?? 0));
  const continuity = totalEpisodes ? topBilling / totalEpisodes : 0;
  if (data.genres?.includes('Anthology') && continuity < 0.25) {
    reasons.push(
      `per-episode anthology — no recurring cast (top billing appears in ${topBilling}/${totalEpisodes} episodes)`,
    );
  } else if (data.genres?.includes('Anthology')) {
    // Fargo, True Detective, The White Lotus: each season stands alone, so a
    // multi-season range would stitch together stories that never met.
    warnings.push('season anthology — cross-season ranges should be disabled, per-season is fine');
  }

  // --- is it the right kind of programme ----------------------------------
  if (data.showType && !['Scripted', 'Animation'].includes(data.showType)) {
    reasons.push(`show type is ${data.showType}, not Scripted`);
  }

  // --- can we actually write it -------------------------------------------
  //
  // The strongest predictor of a bad recap, and it is knowable before spending
  // a generation call. Thin summaries do not produce a thin recap; they
  // produce a confident wrong one, because the model fills gaps from memory.
  if (coverage < 0.6) {
    reasons.push(`Wikipedia coverage ${Math.round(coverage * 100)}% of episodes (need 60%)`);
  } else if (coverage < 0.85) {
    warnings.push(`Wikipedia coverage ${Math.round(coverage * 100)}% — check the thin seasons`);
  }

  // --- scale ---------------------------------------------------------------
  //
  // Not a rejection. A show this size cannot go through whole-show generation
  // in one call, so it needs chunking into season groups.
  if (totalEpisodes > 120) {
    warnings.push(`${totalEpisodes} episodes — too large for a single whole-show call, needs chunking`);
  }

  // Comedy is NOT auto-rejected. Sitcoms genuinely do not need recaps, but
  // serialised comedy (The Bear, Barry) does, and runtime-plus-genre cannot
  // tell them apart. Flagged for a human instead of guessed at.
  if (data.genres?.includes('Comedy') && (data.runtime ?? 60) <= 35) {
    warnings.push('short-form comedy — confirm it is serialised enough to be worth recapping');
  }

  return {
    ok: reasons.length === 0,
    reasons,
    warnings,
    stats: { totalEpisodes, coverage, continuity, seasons: data.seasons.length },
  };
}
