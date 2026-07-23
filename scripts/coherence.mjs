// Do a season's character cards match who its beats are actually about?
//
// The two halves of a season entry are written in the same call and still
// disagree, because the model reaches for what it knows about a show rather
// than reading what it just wrote. Game of Thrones season 1 came back with no
// card for Ned Stark, who is named in five of its seven beats and whose
// execution IS the season — and it did that BOTH under a fixed cap of six
// characters and under an explicit, bolded instruction that anyone central to
// two or more beats must be included.
//
// That is the useful finding: an instruction to be internally consistent with
// its own output does not reliably work. So consistency is computed here and
// enforced downstream (repair-characters.mjs) rather than requested.
//
// Shared by inspect-spine.mjs (report) and repair-characters.mjs (fix) so the
// definition of "coherent" cannot drift between checking and repairing.

/** Capitalised words that are not people. Recall matters more than precision
 *  here — the repair pass asks a model to filter these, and a name wrongly
 *  dropped here can never be recovered. */
const NOT_A_PERSON = new Set([
  'The', 'This', 'That', 'They', 'Their', 'When', 'While', 'With', 'After', 'Before',
  'Then', 'From', 'Into', 'Meanwhile', 'However', 'Later', 'Season', 'Episode', 'Part',
  'What', 'Where', 'Which', 'These', 'Those', 'Some', 'Once', 'Only', 'Also', 'Just',
  'Over', 'Under', 'Both', 'Following', 'Because', 'During', 'Since', 'Though', 'Until',
  'Whether', 'There', 'Three', 'Four', 'Five', 'Several', 'Another', 'Everyone',
  'Everything', 'Someone', 'Something', 'Nobody', 'Nothing', 'Every', 'Each', 'Still',
  'Even', 'Back', 'Away', 'Together', 'Their', 'Have', 'Been', 'Will', 'Would', 'Could',
]);

/**
 * Matchable name tokens from a character card.
 *
 * Must agree exactly with how names are pulled out of beats below, or the two
 * sides never meet. Three cases broke the naive version, all found by the
 * validation set:
 *
 *   Carmen "Carmy" Berzatto   the beats say "Carmy" — the QUOTED NICKNAME is
 *                             the name actually used, and stripping it left
 *                             nothing to match on
 *   Lucerys 'Luke' Velaryon   same, single quotes
 *   Sang-woo, Jun-ho          hyphenated Korean names matched nothing at all,
 *                             so every Squid Game card read as padding
 *
 * So quotes are peeled rather than treated as part of the word, and hyphens
 * and apostrophes are part of a name rather than boundaries.
 */
const surnamesOf = name =>
  name
    .split(/\s+/)
    .map(w => w.replace(/^["'\u2018\u2019\u201c\u201d]+|["'\u2018\u2019\u201c\u201d.,]+$/g, ''))
    .filter(w => /^[A-Z][\w'\u2019-]{2,}$/.test(w));

/**
 * @returns {{ uncarded: Array<{name:string,beats:number}>, unused: string[] }}
 *   uncarded — named in two or more beats but never introduced
 *   unused   — introduced but absent from every beat, usually padding
 */
export function coherence(entry, ignore = new Set()) {
  const carded = new Set(
    (entry.characters ?? []).flatMap(c => surnamesOf(c.name).map(w => w.toLowerCase())),
  );

  const counts = new Map();
  for (const b of entry.beats ?? []) {
    // Count each name once per beat: "Ned ... Ned ... Ned" in one beat is one
    // beat's worth of evidence, not three.
    const seen = new Set();
    // Hyphens are part of the name, not a boundary — "Sang-woo" is one token.
    for (const m of b.text.matchAll(/\b[A-Z][a-z]{2,}(?:-[a-z]+)*\b/g)) {
      if (NOT_A_PERSON.has(m[0])) continue;
      const w = m[0].toLowerCase();
      if (seen.has(w)) continue;
      seen.add(w);
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }

  const uncarded = [...counts.entries()]
    .filter(([w, n]) => n >= 2 && !carded.has(w) && !ignore.has(w))
    .sort((a, b) => b[1] - a[1])
    .map(([name, beats]) => ({ name, beats }));

  const unused = (entry.characters ?? [])
    .filter(c => !surnamesOf(c.name).some(w => counts.has(w.toLowerCase())))
    .map(c => c.name);

  // Existing cards that ARE earning their place — named in at least one beat.
  //
  // Computed rather than left to the repair call's discretion. Told to "keep
  // everyone else who is load-bearing", the model dropped Tyrion, Sansa, Arya
  // and Jon Snow from Game of Thrones season 1 while adding the names it had
  // been handed, trading one imbalance for another. Preservation turns out to
  // be exactly as unreliable as inclusion when it is phrased as an
  // instruction, so it is phrased as data instead.
  const keep = (entry.characters ?? [])
    .filter(c => surnamesOf(c.name).some(w => counts.has(w.toLowerCase())))
    .map(c => c.name);

  return { uncarded, unused, keep };
}

/**
 * Seasons that need repair, with the evidence the repair call needs.
 *
 * Extraction deliberately over-reports — it cannot tell a person from a place,
 * so "Winterfell", "Wall", "King" and the dragons all come through. Those are
 * filtered by the repair call, which knows the difference, and the names it
 * rejects are recorded on the spine as `notPeople`. Without that memory the
 * gate would report the same six seasons as failing forever, and a gate that
 * is never green cannot gate anything.
 */
export function failingSeasons(spine) {
  const ignore = new Set(spine.notPeople ?? []);
  return Object.entries(spine.seasons)
    .map(([season, entry]) => ({ season: Number(season), entry, ...coherence(entry, ignore) }))
    .filter(s => s.uncarded.length > 0 || s.unused.length > 0);
}
