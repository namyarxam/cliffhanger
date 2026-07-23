#!/usr/bin/env node
/**
 * Explicitly link every character card to a cast member, once, per show.
 *
 * WHY A MODEL PASS RATHER THAN BETTER STRING MATCHING
 *
 * Name matching gets most of the way — token rarity weighted by how much of
 * the show each candidate appears in reaches 85-100% on shows TVMaze covers.
 * What it cannot reach is anything where the two names share no words:
 *
 *   The Governor    credited as Philip Blake
 *   Saul Goodman    credited as Jimmy McGill
 *   Helena Eagan    credited as Helly Riggs
 *   Arnold          credited as Bernard Lowe
 *
 * Those are not spelling differences, they are facts about the show. No
 * similarity measure recovers them, and every one of them is a main character
 * whose card would otherwise fall back to key art.
 *
 * This is import-time work that happens once per show and is then frozen into
 * the data, so being explicit costs one call and nothing afterwards — the
 * device does no matching at all, and neither does upload for anything this
 * pass resolved.
 *
 * The result is stored on the spine as `castLinks`, a character-name to
 * cast-index map. upload-recap.mjs consults it first and falls back to the
 * algorithm for anything unlinked, so a show that has not been through this
 * pass still composes.
 *
 * Usage:
 *   node scripts/link-cast.mjs --slug walking-dead
 *   node scripts/link-cast.mjs --all
 *   node scripts/link-cast.mjs --slug westworld --dry-run
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bestMatch, tokenOwners } from './name-match.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'src/recap/data');

// Enough of the cast to contain anyone a recap names, without pasting a
// 250-entry list into the prompt.
const CANDIDATE_LIMIT = 150;

const arg = (flag, fallback = null) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

function askClaude(prompt, model = null) {
  return new Promise((res, rej) => {
    const args = ['-p', '--tools', ''];
    if (model) args.push('--model', model);
    const child = spawn('claude', args, { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('error', rej);
    child.on('close', c => (c === 0 ? res(out) : rej(new Error(`claude exited ${c}: ${err.slice(0, 300)}`))));
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const c = fenced ? fenced[1] : text;
  const a = c.indexOf('{');
  const b = c.lastIndexOf('}');
  if (a === -1) throw new Error(`no JSON in response:\n${text.slice(0, 300)}`);
  return JSON.parse(c.slice(a, b + 1));
}

function buildPrompt(show, names, candidates) {
  const list = candidates
    .map((c, i) => `  ${i}. ${c.character}  —  played by ${c.name} (${c.episodeCount} eps)`)
    .join('\n');

  return `Link each character in a TV recap of ${show.title} to their entry in the cast list.

CHARACTERS NAMED IN THE RECAP:
${names.map(n => `  - ${n}`).join('\n')}

CAST LIST (index. credited role — actor):
${list}

For each recap character, give the index of the cast entry that is the SAME PERSON.

This needs knowledge of the show, not string similarity — that part is already handled. The cases that matter here are the ones where the two names share no words at all, because a recap calls someone by a name the credits do not use:

  - an alias or later identity: "Saul Goodman" is credited as "Jimmy McGill", "The Governor" as "Philip Blake"
  - a character with two identities played by one actor: "Helena Eagan" and "Helly Riggs", "Arnold" and "Bernard Lowe"
  - a name the credits give in full, or in a different order, or with a title attached
  - a character credited under a nickname, or under a formal name the show never uses

Rules:
- Return the index of the actor who PLAYS that character. If several credits cover the same person, choose the one with the most episodes.
- Where a recap character is a group, place, organisation or thing rather than a person ("The Kettlemans", "Mesa Verde", "Fireflies", "Rehoboam"), return null. Do not link a group to one of its members.
- Where a character genuinely does not appear in the cast list, return null.
- Do not guess. A wrong link puts another person's face and name on the card, which is worse than no picture at all — a missing one just falls back to show artwork.

Return ONLY valid JSON mapping each recap character name exactly as written above to an index or null:

{
  "links": {
${names.slice(0, 3).map(n => `    ${JSON.stringify(n)}: 0`).join(',\n')}
  }
}`;
}

async function linkShow(slug, { dryRun, model }) {
  const data = JSON.parse(await readFile(resolve(DATA, `${slug}.json`), 'utf8'));
  const spinePath = resolve(DATA, `${slug}.spine.json`);
  const spine = JSON.parse(await readFile(spinePath, 'utf8'));

  const names = [
    ...new Set(
      Object.values(spine.seasons).flatMap(s => (s.characters ?? []).map(c => c.name)),
    ),
  ];
  if (!names.length) {
    console.log(`  ${slug.padEnd(18)} no characters`);
    return;
  }

  // Sorted by episode count before truncating. TMDB's own credit order is not
  // strictly by prominence, so taking the first 80 raw dropped people the
  // recap actually names — Ned Stark appeared unresolved here while matching
  // fine at upload, purely because the two used different windows.
  const candidates = data.cast
    .filter(c => c.character)
    .sort((a, b) => (b.episodeCount ?? 0) - (a.episodeCount ?? 0))
    .slice(0, CANDIDATE_LIMIT);
  const owners = tokenOwners(candidates.map(c => c.character));

  // Only ask about what the algorithm could not resolve. On most shows that is
  // a handful of names, which keeps the prompt short and the judgement focused
  // on the cases that actually need show knowledge.
  const unresolved = names.filter(
    n => !bestMatch(n, candidates.map((c, i) => ({ name: c.character, i, weight: c.episodeCount })), owners),
  );

  console.log(`  ${slug.padEnd(18)} ${names.length} characters, ${unresolved.length} unresolved by matching`);
  if (!unresolved.length) return;
  console.log(`    ${unresolved.join(', ')}`);
  if (dryRun) return;

  const parsed = extractJSON(await askClaude(buildPrompt(data, unresolved, candidates), model));
  const links = spine.castLinks ?? {};
  let linked = 0;
  for (const [name, idx] of Object.entries(parsed.links ?? {})) {
    if (idx === null || idx === undefined) continue;
    const row = candidates[Number(idx)];
    if (!row) continue;
    links[name] = { actor: row.name, character: row.character };
    linked++;
    console.log(`    ✓ ${name} → ${row.name} (${row.character})`);
  }
  for (const n of unresolved) if (!links[n]) console.log(`    · ${n} → left unlinked`);

  spine.castLinks = links;
  await writeFile(spinePath, JSON.stringify(spine, null, 2));
  console.log(`    linked ${linked}/${unresolved.length}`);
}

async function main() {
  const slugs = process.argv.includes('--all')
    ? (await readdir(DATA))
        .filter(f => f.endsWith('.spine.json') && !f.includes('bak'))
        .map(f => f.replace('.spine.json', ''))
    : [arg('--slug')].filter(Boolean);

  if (!slugs.length) {
    console.error('\n✗ pass --slug <name> or --all\n');
    process.exit(1);
  }

  const opts = { dryRun: process.argv.includes('--dry-run'), model: arg('--model') };
  console.log('');
  for (const slug of slugs) {
    try {
      await linkShow(slug, opts);
    } catch (e) {
      console.log(`  ${slug.padEnd(18)} ✗ ${e.message}`);
    }
  }
  console.log('');
}

main().catch(e => {
  console.error(`\n✗ ${e.message}\n`);
  process.exit(1);
});
