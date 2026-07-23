#!/usr/bin/env node
/**
 * Finale reveal pass — the one place the grounding rule has to be relaxed.
 *
 * WHY THIS EXISTS
 * generate-spine.mjs grounds every claim in official episode synopses, which is
 * what keeps plot facts from being hallucinated. But official synopses are
 * marketing copy, and marketing copy is deliberately evasive at exactly the
 * climax. Silo's S1 finale synopsis reads, in full:
 *
 *   "Juliette's fate seems sealed when certain truths finally come to light."
 *
 * The actual reveal — that there are many more silos — is nowhere in the source
 * data, so a synopsis-grounded generator cannot produce it. The result is a
 * recap whose "Cliffhanger" act gestures at a payoff instead of delivering it,
 * which is the one failure the act cannot afford. A cliffhanger is by
 * definition the thing the marketing withheld.
 *
 * WHAT THIS DOES DIFFERENTLY
 * For the finale beat and the cliffhanger ONLY, the model may answer from its
 * own knowledge of the show. Two guardrails make that acceptable:
 *   - Everything produced here is force-flagged needsVerify, so it lands on a
 *     human review list rather than shipping unchecked.
 *   - The model is explicitly permitted to return null. Declining is a valid,
 *     expected answer; inventing a reveal for a show it doesn't know is the
 *     failure mode we're guarding against, and giving it an exit makes
 *     confabulation less likely than forcing an answer.
 *
 * This is a merge pass, not a regeneration — it edits only the finale beat and
 * cliffhanger of an existing spine file and leaves approved content untouched.
 *
 * Usage:
 *   node scripts/generate-reveal.mjs --slug silo
 */

import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function askClaude(prompt) {
  return new Promise((res, rej) => {
    const child = spawn('claude', ['-p'], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('error', rej);
    child.on('close', code => (code === 0 ? res(out) : rej(new Error(`claude exited ${code}: ${err.slice(0, 300)}`))));
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`No JSON in response:\n${text.slice(0, 300)}`);
  return JSON.parse(candidate.slice(start, end + 1));
}

function buildPrompt(show, season, finaleEp) {
  return `${show.title} — season ${season.season} finale, "${finaleEp.name}" (episode ${finaleEp.episode}).

The official synopsis for this episode is:
  "${finaleEp.overview}"

That synopsis is deliberately vague because it is marketing copy written to avoid spoiling the ending. I am writing a RECAP for someone who already watched this season and has forgotten it. For them, the ending is the single most important thing to remember — it is the reason they are about to watch the next season. Vagueness is useless here.

So: from your own knowledge of this show, what ACTUALLY happens at the end of season ${season.season}? Specifically the final reveal or closing image — the thing a viewer would describe if asked "how did season ${season.season} end?"

CRITICAL — read this before answering:
If you are not genuinely confident about this show's season ${season.season} ending, return null for "reveal". Returning null is a correct and expected answer. Do NOT construct a plausible-sounding ending. A missing reveal is recoverable; a confidently wrong one destroys the reader's trust in the entire recap. Only answer if you actually know this show.

If you do know it:
- "reveal.text": two sentences maximum, present tense, plain and concrete. State the actual reveal outright. No teasing, no "little does she know", no rhetorical questions.
- "reveal.label": a 2-3 word title for this beat.
- "cliffhanger.text": one or two sentences framing where the story stands now that the reveal has landed.
- "cliffhanger.questions": exactly 3 genuinely open questions the next season has to answer. These must be questions the ending RAISES — not questions the ending already answered, and not questions the reader would need the recap to answer for them.
- "confidence": "high" or "medium". Use medium if you know the broad shape but not the specifics.

Do not reference anything beyond season ${season.season}.

Return ONLY valid JSON:

{
  "reveal": { "label": "...", "text": "..." } | null,
  "cliffhanger": { "text": "...", "questions": ["...", "...", "..."] },
  "confidence": "high"
}`;
}

async function main() {
  const argv = process.argv.slice(2);
  const slug = argv[argv.indexOf('--slug') + 1] || 'silo';

  const dataPath = resolve(ROOT, `src/recap/data/${slug}.json`);
  const spinePath = resolve(ROOT, `src/recap/data/${slug}.spine.json`);
  const show = JSON.parse(await readFile(dataPath, 'utf8'));
  const spine = JSON.parse(await readFile(spinePath, 'utf8'));

  console.log(`\n▸ Finale reveal pass for "${show.title}"\n`);

  for (const season of show.seasons) {
    const finaleEp = season.episodes[season.episodes.length - 1];
    process.stdout.write(`  S${season.season} finale "${finaleEp.name}" … `);

    const parsed = extractJSON(await askClaude(buildPrompt(show, season, finaleEp)));
    const target = spine.seasons[String(season.season)];
    if (!target) {
      console.log('no spine entry, skipped');
      continue;
    }

    if (!parsed.reveal) {
      console.log('declined (no confident reveal) — leaving existing cliffhanger');
      continue;
    }

    // Appended, not substituted. The synopsis-grounded finale beat sets the
    // situation up; the reveal pays it off. Replacing would discard verified
    // content in favour of unverified content.
    target.revealBeat = {
      label: `S${season.season} · ${parsed.reveal.label}`,
      text: parsed.reveal.text,
      anchorEpisode: finaleEp.episode,
      // Always true — this bypassed the synopsis grounding by design.
      needsVerify: true,
      source: 'model-knowledge',
      confidence: parsed.confidence ?? 'unknown',
    };
    if (parsed.cliffhanger) {
      target.cliffhanger = { ...parsed.cliffhanger, needsVerify: true, source: 'model-knowledge' };
    }

    console.log(`✓ "${parsed.reveal.label}" (confidence: ${parsed.confidence ?? '?'})`);
  }

  await writeFile(spinePath, JSON.stringify(spine, null, 2));
  console.log(`\n✓ merged into ${spinePath}`);
  console.log('  ⚠ everything from this pass is flagged needsVerify — check it before demoing\n');
}

main().catch(err => {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
});
