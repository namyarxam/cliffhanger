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
 * Words a recap uses to distinguish two versions of one person — "Real Elliot",
 * "Young Ned", "Evil Harry". They are never part of the credited name.
 *
 * They break the surname rule, which reads the LAST token as the family name:
 * in "Real Elliot" the identifying token becomes "real" and "elliot" is treated
 * as a surname, so the card cannot match Elliot at all — and "real" is free to
 * shorten into "Realty", which put a Virtual Realty Employee's face on Elliot's
 * card. So a qualifier may never act as a shortened given name, and when it is
 * the ONLY identifying token the surname slot is opened up so the real name can
 * match. The token is kept for scoring rather than removed — dropping it made
 * "Young Ian Murray" match the adult Ian, because the qualifier was the only
 * thing telling the two apart.
 */
const QUALIFIERS = new Set([
  'real', 'young', 'younger', 'old', 'older', 'future', 'past', 'present',
  'alternate', 'alternative', 'evil', 'dark', 'baby', 'teen', 'adult', 'new',
]);

/**
 * Nicknames the two sources disagree on, in BOTH directions — the spine writes
 * "James Holden" where the credits say "Jim", and "Jim Harper" where they say
 * "James". Prefix matching cannot reach these: "nathan" does not begin with
 * "nate", and "margaret" shares nothing with "maggie".
 *
 * Each row is one person's interchangeable names. Membership in the same row is
 * treated as a full match, not a half one, because this is a curated list
 * rather than a guess — the risk is a missing pair, never a wrong pair.
 */
const NICKNAME_ROWS = [
  ['james', 'jim', 'jimmy', 'jamie'], ['margaret', 'maggie', 'meg', 'peggy'],
  ['joseph', 'joe', 'joey'], ['nathan', 'nate', 'nathaniel'],
  ['robert', 'rob', 'bob', 'bobby'], ['richard', 'rick', 'dick', 'ricky'],
  ['william', 'will', 'bill', 'billy', 'liam'], ['michael', 'mike', 'mickey'],
  ['thomas', 'tom', 'tommy'], ['charles', 'charlie', 'chuck', 'chas'],
  ['edward', 'ed', 'eddie', 'ted', 'ned'], ['anthony', 'tony'],
  ['daniel', 'dan', 'danny'], ['david', 'dave', 'davey'],
  ['christopher', 'chris'], ['matthew', 'matt'], ['andrew', 'andy', 'drew'],
  ['patrick', 'pat', 'paddy'], ['elizabeth', 'liz', 'beth', 'lizzie', 'eliza'],
  ['katherine', 'catherine', 'kate', 'katie', 'kathy', 'cathy', 'kat'],
  ['jennifer', 'jen', 'jenny'], ['jessica', 'jess'], ['rebecca', 'becca', 'becky'],
  ['alexander', 'alex', 'sasha', 'xander'], ['alexandra', 'alex', 'lexi'],
  ['nicholas', 'nick', 'nicky'], ['theodore', 'theo', 'teddy'],
  ['abigail', 'abby'], ['stephen', 'steven', 'steve'], ['peter', 'pete'],
  ['gregory', 'greg'], ['jonathan', 'jon', 'johnny'], ['john', 'jack', 'johnny'],
  ['francis', 'frank', 'frankie'], ['vincent', 'vince'], ['raymond', 'ray'],
  ['lawrence', 'larry'], ['ronald', 'ron', 'ronnie'], ['kenneth', 'ken', 'kenny'],
  ['eugene', 'gene'], ['walter', 'walt'], ['albert', 'al', 'bert'],
  ['samuel', 'sam', 'sammy'], ['benjamin', 'ben', 'benny'],
  ['deborah', 'debra', 'deb', 'debbie'], ['barbara', 'barb', 'babs'],
  ['susan', 'sue', 'susie'], ['pamela', 'pam'], ['victoria', 'vicky', 'tori'],
  ['veronica', 'ronnie', 'vee'], ['dorothy', 'dot', 'dottie'],
  ['eleanor', 'ellie', 'nell'], ['isabella', 'isabel', 'bella', 'izzy'],
  ['gabriel', 'gabe'], ['zachary', 'zach'], ['joshua', 'josh'],
  ['timothy', 'tim'], ['philip', 'phillip', 'phil'], ['martin', 'marty'],
];
const NICKNAMES = new Map();
for (let i = 0; i < NICKNAME_ROWS.length; i++) {
  for (const n of NICKNAME_ROWS[i]) {
    if (!NICKNAMES.has(n)) NICKNAMES.set(n, new Set());
    NICKNAMES.get(n).add(i);
  }
}
/** Do two name tokens refer to the same given name? */
const sameGiven = (a, b) => {
  if (a === b) return true;
  const A = NICKNAMES.get(a), B = NICKNAMES.get(b);
  if (!A || !B) return false;
  for (const i of A) if (B.has(i)) return true;
  return false;
};

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
  // Nicknames and shortened credits are a RESCUE, not a scoring boost.
  //
  // Scored alongside everything else they displace correct matches: "Kate Kane"
  // moved to her stepmother "Catherine Hamilton-Kane" on kate/catherine, and
  // "Senator Jamie Moreno" moved to "James Greer" on jamie/james. Both were
  // already matching the right person. Running them only when the strict pass
  // finds NOBODY means a card that works today cannot be taken away by them.
  return score(name, candidates, owners, false) ?? score(name, candidates, owners, true);
}

function score(name, candidates, owners, relaxed) {
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
  let identifying = want.length > 1 ? new Set(want.slice(0, -1)) : new Set(want);
  // "Real Elliot" leaves only "real" to identify with, and the one token that
  // names the person is sitting in the surname slot where nothing may match it.
  // When every identifying token is a qualifier, let the last token identify.
  if ([...identifying].every(t => QUALIFIERS.has(t))) identifying = new Set(want);

  let best = null;
  let bestScore = 0;
  for (const c of candidates) {
    const haveTokens = tokens(c.name);
    const have = new Set(haveTokens);
    const shared = want.filter(w => have.has(w));

    // A recap calls someone what people call them; the credits use what is on
    // the birth certificate. "Ben Linus" is credited "Benjamin Linus", "Sam
    // LaRusso" as "Samantha" — no token is shared, so the card shipped with no
    // face at all.
    //
    // Only a GIVEN name may shorten this way. Matching against the last token
    // would let "Ben" claim the surname "Benavent", which is how a card gets
    // somebody else's face — the failure this module exists to prevent. The
    // two-character gap keeps near-misses ("Ann"/"Anna") from colliding, and a
    // prefix hit is worth half an exact one so a real name match always wins.
    // Runs even when the surname already matched exactly: "Ben Linus" shares
    // "linus" with "Benjamin Linus", but a surname alone is refused, so without
    // checking the given name here the card is still turned away.
    const prefixed = [];
    const lastOf = haveTokens[haveTokens.length - 1];
    for (const w of want) {
      if (w.length < 3 || have.has(w) || !identifying.has(w) || QUALIFIERS.has(w)) continue;
      for (const h of haveTokens) {
        if (haveTokens.length > 1 && h === lastOf) continue;
        if (h.length >= w.length + 2 && h.startsWith(w)) { prefixed.push(h); break; }
      }
    }

    // Nicknames, both directions, on the identifying tokens only.
    const nicked = [];
    if (relaxed) {
      for (const w of want) {
        if (have.has(w) || !identifying.has(w)) continue;
        for (const h of haveTokens) {
          if (haveTokens.length > 1 && h === lastOf) continue;
          if (sameGiven(w, h)) { nicked.push(h); break; }
        }
      }
    }

    // The credits carry a shorter form of the same name: "Mrs Coulter" for
    // "Mrs Marisa Coulter", "Eve" for "Atom Eve". Every token the candidate has
    // is one the card also has, so it cannot be a DIFFERENT person — which is
    // what the surname rule is guarding against. That rule refuses these
    // outright, since the only shared token sits in the surname slot.
    //
    // Direction matters. "Jame Eagan" is not a subset of "Helena Eagan", so the
    // father still cannot claim the daughter's card.
    const subsumed = relaxed && haveTokens.length && haveTokens.every(h => want.includes(h));

    if (!shared.length && !prefixed.length && !nicked.length) continue;
    // The match must rest on a given name — exact, shortened, or a nickname —
    // never a surname, unless the credited name is wholly contained in the card.
    if (!prefixed.length && !nicked.length && !subsumed &&
        !shared.some(w => identifying.has(w))) continue;
    const rarity =
      shared.reduce((a, w) => a + 1 / (owners.get(w) ?? 1), 0) +
      nicked.reduce((a, h) => a + 1 / (owners.get(h) ?? 1), 0) +
      prefixed.reduce((a, h) => a + 0.5 / (owners.get(h) ?? 1), 0);
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
