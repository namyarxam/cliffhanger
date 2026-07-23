#!/usr/bin/env node
/**
 * Fix character cards that disagree with the beats they sit alongside.
 *
 * WHY THIS IS A SEPARATE PASS
 *
 * Two attempts to solve this inside the generation prompt both failed. A fixed
 * cap of six produced Game of Thrones season 1 with no Ned Stark — named in
 * five of seven beats, and the season is his execution. Replacing the cap with
 * a criterion ("include anyone whose absence would confuse you", plus an
 * explicit non-negotiable rule about anyone in two or more beats) produced ten
 * characters per season, still no Ned, and three cards per season for people
 * who appear in no beat at all.
 *
 * The model has strong priors about who a show's main characters are and
 * reaches for the series roster instead of reading the beats it has just
 * written. Asking it to check itself does not work.
 *
 * So the requirement stops being an instruction and becomes DATA. The names
 * are extracted mechanically from the beats and handed over as a list. The
 * model's remaining job is judgement it is actually good at — which of these
 * strings are people rather than places or houses, and how to describe them —
 * not recall it has already demonstrated it will skip.
 *
 * Only seasons that fail the check are sent, and all failing seasons of a show
 * go in one call, so a clean show costs nothing and a broken one costs one
 * call rather than one per season.
 *
 * Usage:
 *   node scripts/repair-characters.mjs --slug game-of-thrones
 *   node scripts/repair-characters.mjs --slug game-of-thrones --spine x.json --out y.json
 *   node scripts/repair-characters.mjs --slug game-of-thrones --dry-run
 */

import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { failingSeasons } from './coherence.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'src/recap/data');

const arg = (flag, fallback = null) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

function askClaude(prompt, model = null) {
  return new Promise((res, rej) => {
    // Tools off, as in generate-spine.mjs — given them, the CLI has decided to
    // write files itself and return prose instead of JSON.
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
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1) throw new Error(`no JSON in response:\n${text.slice(0, 300)}`);
  return JSON.parse(candidate.slice(start, end + 1));
}

function buildPrompt(show, failures) {
  const blocks = failures
    .map(f => {
      const beats = f.entry.beats
        .map(b => `    - ${b.text}`)
        .join('\n');
      const required = f.uncarded.map(u => `"${u.name}" (in ${u.beats} beats)`).join(', ') || 'none';
      const keep = f.keep.join(', ') || 'none';
      const drop = f.unused.length ? f.unused.join(', ') : 'none';
      return `SEASON ${f.season}
  Beats:
${beats}

  KEEP these (already listed, and each appears in the beats): ${keep}
  ADD these (appear in 2+ beats, currently missing): ${required}
  REMOVE these (listed but in no beat at all): ${drop}`;
    })
    .join('\n\n');

  return `You are fixing the character list for a TV recap of ${show.title}.

Each season of a recap has a short list of people, shown as cards before the story beats. Their job is to let a returning viewer recognise everyone the beats are about. The lists below are wrong: some people the beats depend on are missing, and some listed people never appear in the story at all.

${blocks}

Rebuild the character list for each season above.

The membership of each list has already been decided for you by reading the beats. Do not second-guess it — you are not being asked who the important characters of this show are, you are being asked to describe the people the beats are about.

Rules:
- Include everyone on the KEEP line. All of them. They appear in the beats and dropping them leaves the viewer meeting a stranger.
- Include everyone on the ADD line THAT IS A PERSON. These were extracted from the beats, so they are not suggestions. Some will be places, houses, titles, armies or animals rather than people ("Winterfell", "Lannisters", "King", "Wildlings", "Wall") — silently omit those. Expand partial names to what a viewer would recognise ("ned" -> "Ned Stark", "roose" -> "Roose Bolton").
- Omit everyone on the REMOVE line.
- Add nobody else.
- Order by how badly the viewer needs them, most essential first.
- Describe each person AS OF THE END of that season — their position and current situation, in one sentence. Not their whole arc. Never mention anything from a later season.

Return ONLY valid JSON:

{
  "seasons": {
${failures.map(f => `    "${f.season}": [{ "name": "Full Name", "line": "One sentence: who they are and where they stand at the end of this season.", "note": "optional" }]`).join(',\n')}
  }
}`;
}

async function main() {
  const slug = arg('--slug');
  if (!slug) {
    console.error('\n✗ pass --slug <name>\n');
    process.exit(1);
  }
  const spineName = arg('--spine', `${slug}.spine.json`);
  const outName = arg('--out', spineName);
  const dryRun = process.argv.includes('--dry-run');
  const model = arg('--model');

  const show = JSON.parse(await readFile(resolve(DATA, `${slug}.json`), 'utf8'));
  const spine = JSON.parse(await readFile(resolve(DATA, spineName), 'utf8'));

  const failures = failingSeasons(spine);
  console.log(`\n▸ ${show.title} — ${failures.length} season(s) need repair`);
  for (const f of failures) {
    console.log(
      `  S${f.season}: missing ${f.uncarded.map(u => u.name).join(', ') || '—'}` +
        `${f.unused.length ? ` · padding ${f.unused.join(', ')}` : ''}`,
    );
  }
  if (!failures.length) {
    console.log('  ✓ nothing to do\n');
    return;
  }
  if (dryRun) {
    console.log('\n  (dry run — no call made)\n');
    return;
  }

  console.log(`\n  … repairing in 1 call`);
  const parsed = extractJSON(await askClaude(buildPrompt(show, failures), model));

  for (const f of failures) {
    const fixed = parsed.seasons?.[String(f.season)];
    if (!Array.isArray(fixed) || !fixed.length) {
      console.warn(`  ⚠ S${f.season} missing from response — left unchanged`);
      continue;
    }
    spine.seasons[String(f.season)].characters = fixed;
  }

  await writeFile(resolve(DATA, outName), JSON.stringify(spine, null, 2));

  // Re-check against the repaired spine. The repair is a model call like any
  // other and can itself be incomplete, so the same gate runs again rather
  // than assuming success.
  const still = failingSeasons(spine);
  console.log(`\n  after repair: ${still.length} season(s) still failing`);
  for (const f of still) {
    console.log(
      `    S${f.season}: missing ${f.uncarded.map(u => u.name).join(', ') || '—'}` +
        `${f.unused.length ? ` · padding ${f.unused.join(', ')}` : ''}`,
    );
  }
  console.log(`\n✓ ${resolve(DATA, outName)}\n`);
}

main().catch(err => {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
});
