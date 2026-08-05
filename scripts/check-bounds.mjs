#!/usr/bin/env node
/**
 * Does any part of a season name somebody that season's own source never does?
 *
 * WHY THIS IS THE CHECK THAT MATTERS MOST
 *
 * The season cap in get_recap is airtight: ask for more seasons than you have
 * finished and you get fewer. But it protects the BOUNDARY, not the contents.
 * A beat inside an allowed season can still name a person or event from a later
 * one, and that leaks exactly the same thing the cap exists to prevent —
 * Downton Abbey shipped an S3 beat labelled with a death the S3 source never
 * covers, She-Ra an S4 beat labelled with an arrival that happens in S5.
 *
 * Both were LABELS. The audit flagged them and repair could not fix them,
 * because repair only rewrites a beat's text. They survived every round.
 *
 * WHY DETERMINISTIC AND NOT A MODEL
 *
 * The LLM audit is a sampling instrument — re-running it on unchanged text
 * surfaces a different set each time, so it can never say "done". This asks a
 * question with one answer: is this name in this season's source, yes or no.
 * Same result every run, which is the only way a check ever finishes.
 *
 * WHAT IT DELIBERATELY DOES NOT CATCH
 *
 * Leaks carried by ordinary words. "Matthew killed at his happiest" names
 * nobody the season does not already know — the leak is the verb. Names are
 * the tractable half; a person reading the flagged list is the other half.
 *
 * Usage:
 *   node scripts/check-bounds.mjs
 *   node scripts/check-bounds.mjs --slug downton-abbey
 *   node scripts/check-bounds.mjs --json
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'src/recap/data');

const arg = (f, d = null) => {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : d;
};

/**
 * Words that begin a title-cased label and mean nothing on their own. Without
 * this the first word of every label reads as a name: "Raid on Woodbury",
 * "Boxed in", "Endings" all flagged, and 684 hits buried the 20 real ones.
 */
const STOP = new Set(`the and but for with from into onto over under after before while when where what why how who all one two three four five six seven eight nine ten new old last first final next another each every some none both his her its their our your my this that these those they them him she does not now then than also only just even still back down out off away again more most less least very much many few own same other such about against between through during without within along across behind beyond around near far here there`.split(/\s+/));

/**
 * Lowercase, drop possessives, and remove apostrophes entirely.
 *
 * The two sources disagree on apostrophe encoding — straight vs curly — so
 * "D'Angelo" in a beat never matched "D\u2019Angelo" in the source and every
 * mention read as absent. Stripping them from BOTH sides is what makes the
 * comparison mean anything.
 */
const norm = w =>
  w.toLowerCase()
    .replace(/[\u2018\u2019'`]/g, '')
    .replace(/s$/, m => m) // keep plurals; only the apostrophe form is a possessive
    .replace(/[.,;:!?]/g, '');

/** Same normalisation applied to a whole block of source text. */
const normText = t => t.toLowerCase().replace(/[\u2018\u2019'`]/g, '');

const slugs = arg('--slug')
  ? [arg('--slug')]
  : readdirSync(DATA)
      .filter(f => f.endsWith('.spine.json') && !f.includes('bak'))
      .map(f => f.replace('.spine.json', ''))
      .sort();

const findings = [];

for (const slug of slugs) {
  const sp = resolve(DATA, `${slug}.spine.json`);
  const dj = resolve(DATA, `${slug}.json`);
  if (!existsSync(sp) || !existsSync(dj)) continue;
  const spine = JSON.parse(readFileSync(sp, 'utf8'));
  const data = JSON.parse(readFileSync(dj, 'utf8'));

  /**
   * Everyone this SHOW knows about — credited cast plus every character card.
   *
   * This is what separates a leaked name from an ordinary word. "Endings" is
   * absent from the source too and means nothing; "Prime" is absent AND is
   * somebody in this show, which is the whole signal.
   */
  const known = new Set();
  const add = s => {
    for (const t of String(s ?? '').toLowerCase().match(/[a-z'’-]{3,}/g) ?? []) {
      const w = norm(t);
      if (w.length > 2 && !STOP.has(w)) known.add(w);
    }
  };
  for (const c of data.cast ?? []) add(c.character);
  for (const e of Object.values(spine.seasons)) for (const c of e.characters ?? []) add(c.name);

  for (const [n, entry] of Object.entries(spine.seasons)) {
    const eps = data.seasons.find(s => s.season === Number(n))?.episodes ?? [];
    const srcRaw = eps
      .map(e => `${e.name ?? ''} ${e.plot || e.overview || ''}`)
      .join(' ');
    const src = normText(srcRaw);
    // Too thin to judge: everything would flag, which says something about our
    // fetch rather than about the spine.
    if (src.length < 400) continue;

    /**
     * Names are matched as PHRASES, not tokens.
     *
     * Wikipedia writes "Joe" where a character card writes "Joe Goldberg", so
     * token-by-token every surname in the library reads as absent — 2,957
     * findings, none of them leaks. A person is only genuinely missing from a
     * season when NO part of their name appears in it.
     */
    const scan = (text, where) => {
      const body = String(text ?? '').replace(/^\s*S\d+\s*[·:•-]\s*/i, '');
      const phrases = body.match(/\b[A-Z][a-zA-Z'’-]{2,}(?:\s+[A-Z][a-zA-Z'’-]{2,})*/g) ?? [];
      const seen = new Set();
      for (const phrase of phrases) {
        const parts = phrase.split(/\s+/).map(norm).filter(w => w.length > 2 && !STOP.has(w));
        if (!parts.length) continue;
        const key = parts.join(' ');
        if (seen.has(key)) continue;
        seen.add(key);
        // Any part present means the show's own vocabulary covers this person.
        // "Peter's" normalises to "peters"; the source has "peter".
        const present = w => src.includes(w) || (w.endsWith('s') && src.includes(w.slice(0, -1)));
        if (parts.some(present)) continue;
        // And it must be somebody, not just an unusual word.
        if (!parts.some(w => known.has(w))) continue;
        findings.push({ slug, season: Number(n), where, name: phrase, text: String(text) });
      }
    };

    (entry.beats ?? []).forEach((b, i) => {
      scan(b.label, `B${i + 1}.label`);
      scan(b.text, `B${i + 1}.text`);
    });
    // Character card NAMES are deliberately not scanned. A card carries the
    // full formal name — "Cirilla 'Ciri' of Cintra", "Emhyr var Emreis" —
    // where the source uses a short one, so every such card reads as absent.
    // That is a vocabulary mismatch, not a leak. Whether a card resolves to
    // the right person is the portrait check's job, not this one. Every leak
    // this check exists for lived in narration: a label, a beat, a cliffhanger.
    if (entry.cliffhanger) scan(entry.cliffhanger.text, 'X1.text');
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(findings, null, 2));
  process.exit(0);
}

console.log(`\nnames used in a season whose own source never mentions them\n`);
const byShow = {};
for (const f of findings) (byShow[f.slug] ??= []).push(f);
const shows = Object.keys(byShow).sort();
for (const s of shows) {
  console.log(`  ${s}`);
  for (const f of byShow[s]) {
    console.log(`      S${f.season} ${f.where.padEnd(11)} "${f.name}"`);
    console.log(`          ${f.text.slice(0, 120)}`);
  }
}
console.log(`\n  ${findings.length} findings across ${shows.length} shows (of ${slugs.length} scanned)`);
console.log(`  Names only — a leak carried by ordinary words is invisible here.\n`);
