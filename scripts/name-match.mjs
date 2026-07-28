// Matching a character name against a list of character names.
//
// This is shared because getting it wrong has now caused three separate
// visible bugs, each in a different file:
//
//   1. Rhaenyra Targaryen's card showed Matt Smith. "Share any token, take the
//      first hit" matched her to "Prince Daemon Targaryen" on the surname.
//   2. Ned Stark had no photo, because "ned" is diluted across "Lord Eddard
//      'Ned' Stark", "Young Ned Stark" and "Young Ned".
//   3. Alicent and Aegon fell back to actor headshots mid-sequence, because
//      TMDB credits "Queen Alicent Hightower" where TVMaze has "Lady Alicent
//      Hightower", and the lookup was exact string equality.
//
// All three are the same problem: two sources naming one person differently,
// with titles that differ and surnames that identify nobody.

/**
 * Rank, title and honorific words that are never the name.
 *
 * Fantasy and period titles matter as much as modern ones here — House of the
 * Dragon and Game of Thrones credit almost everyone with a rank, and the two
 * sources rarely agree on which one ("Queen" vs "Lady", "King" vs "Prince",
 * because a character's rank changes across a series while a credit does not).
 */
export const TITLES = new Set([
  'sheriff', 'deputy', 'judge', 'mayor', 'dr', 'doctor', 'mr', 'mrs', 'ms',
  'captain', 'cap', 'chief', 'admiral', 'secretary', 'sergeant', 'sgt', 'lt',
  'colonel', 'commander', 'general', 'major', 'officer', 'detective', 'agent',
  'professor', 'father', 'sister', 'brother', 'aunt', 'uncle',
  'king', 'queen', 'prince', 'princess', 'lord', 'lady', 'ser', 'sir',
  'maester', 'grand', 'septa', 'septon', 'khal', 'khaleesi', 'archmaester', 'the',
]);

/** Name tokens, lowercased, titles and short words removed. */
export const tokens = s => {
  const cleaned = String(s ?? '')
    .toLowerCase()
    // Drop parenthetical role qualifiers before tokenising. TMDB credits voice
    // roles as "Vi (voice)", so without this every animated character shares
    // the token "voice" — owned by the whole cast, it identifies nobody, and it
    // is the only surviving token for a short name like "Vi" once the length
    // filter runs. Also covers "(uncredited)", "(as Foo)", etc.
    .replace(/\([^)]*\)/g, ' ')
    .split(/[^a-z]+/)
    .filter(Boolean);
  const kept = cleaned.filter(t => t.length > 2 && !TITLES.has(t));
  // Never strip a name down to nothing. A genuinely short name — "Vi", "Bo",
  // "CJ" — is all a card has to match on, and dropping its only token means it
  // can never match anything. Fall back to the un-length-filtered tokens so the
  // short name survives, without loosening the length rule for normal names.
  return kept.length ? kept : cleaned.filter(t => !TITLES.has(t));
};


/**
 * A card name can carry two identities for one person — Severance writes
 * "Helly R. / Helena Eagan" and "Gemma Scout / Ms. Casey". Each side is a
 * complete name and must be matched separately.
 *
 * Treating the whole string as one name breaks the surname rule, which assumes
 * the last token is the family name: in "Gemma Scout / Ms. Casey" the last
 * token is Casey, so Scout counted as a given name and matched Mark Scout.
 * That card was then dropped as a duplicate of Mark's and vanished from the
 * recap entirely.
 */
export const alternates = name =>
  String(name ?? '')
    .split(/\s*\/\s*/)
    .map(s => s.trim())
    .filter(Boolean);

/** How many entries each token belongs to. A token half the cast shares
 *  identifies nobody. */
export function tokenOwners(names) {
  const owners = new Map();
  for (const n of names) {
    for (const t of new Set(tokens(n))) owners.set(t, (owners.get(t) ?? 0) + 1);
  }
  return owners;
}

/**
 * Best match for `name` among `candidates`.
 *
 * @param candidates  [{ name, weight }] — weight is how much of the show the
 *                    candidate appears in, used to separate a character from
 *                    their own flashback casting. Pass 1 when unknown.
 * @returns the winning candidate, or null when nothing clears the bar.
 *
 * Returning null is a real answer. A missing portrait falls back to key art
 * and reads as unremarkable; a confident wrong match puts another person's
 * face on the card.
 */
export function bestMatch(name, candidates, owners) {
  // Try each identity separately and take the best-scoring result.
  const parts = alternates(name);
  if (parts.length > 1) {
    for (const p of parts) {
      const hit = bestMatch(p, candidates, owners);
      if (hit) return hit;
    }
    return null;
  }

  const want = tokens(name);
  if (!want.length) return null;

  const exact = candidates.find(c => tokens(c.name).join(' ') === want.join(' '));
  if (exact) return exact;

  // A surname alone never identifies anyone.
  //
  // "Helena Eagan" matched "Jame Eagan" — her father — because Helena is
  // credited as Helly Riggs, so "eagan" belonged to exactly one cast member
  // and looked distinctive. The card carried Michael Siberry's face and name.
  // Rarity cannot catch this: the token genuinely was rare, it was just the
  // wrong half of the name.
  //
  // So a match must rest on something other than the last token — a given
  // name, a nickname, a middle name. Single-token names are exempt, having no
  // surname to be confused by.
  const identifying = want.length > 1 ? new Set(want.slice(0, -1)) : new Set(want);

  let best = null;
  let bestScore = 0;
  for (const c of candidates) {
    const have = new Set(tokens(c.name));
    const shared = want.filter(w => have.has(w));
    if (!shared.length) continue;
    if (!shared.some(w => identifying.has(w))) continue;
    const rarity = shared.reduce((a, w) => a + 1 / (owners.get(w) ?? 1), 0);
    // A token carried by more than five entries identifies nobody, however
    // prominent the candidate.
    if (rarity < 0.2) continue;
    // Log-scaled so presence breaks ties between plausible candidates without
    // letting a series regular beat a genuine name match on volume alone.
    const score = rarity * Math.log1p(c.weight ?? 1);
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}
