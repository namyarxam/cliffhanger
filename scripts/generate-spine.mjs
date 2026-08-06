#!/usr/bin/env node
/**
 * Recap spine generator — the editorial pass.
 *
 * The fetch script (fetch-recap.mjs) gets FACTS: episodes, synopses, images.
 * This pass gets JUDGEMENT: which of those events are load-bearing, in what
 * order they explain each other, and which episode each beat should be
 * illustrated by.
 *
 * THE CENTRAL DESIGN DECISION
 * We do NOT ask for "the most important scenes". A highlight reel optimises for
 * peaks; a recap optimises for comprehension. Someone returning after a year
 * doesn't need the biggest moments, they need the causal thread — and
 * "important" and "load-bearing" are different properties. A shocking death may
 * carry nothing forward; a quiet scene where someone starts to doubt a lie may
 * carry an entire next season.
 *
 * So the prompt asks for a SPINE: the chain of events you need to understand
 * where everyone stands. Highlight knowledge is still used, but only to pick
 * the anchor episode (which still illustrates the beat) and to sharpen phrasing
 * — never to decide which beats exist.
 *
 * Facts stay grounded in the fetched synopses. Anything the model asserts that
 * isn't derivable from them must be flagged needsVerify, so the human review
 * step has a short list rather than a whole script to re-check.
 *
 * Runs through the authenticated `claude` CLI, so no API key is required.
 *
 * Usage:
 *   node scripts/generate-spine.mjs --slug silo
 */

import { readFile, writeFile, rename } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Beat captions render over a full-screen image; past this they stop reading as
// captions and start reading as paragraphs. Used in both the prompt and the
// post-generation check so the two can't drift.
const BEAT_CHAR_LIMIT = 180;

// Measured, not guessed: the hand-reviewed Silo spine that read best averaged
// ~150. Giving only a ceiling drifts output toward it — adding the whole-show
// weighting rules pushed the average from 151 to 168, since every extra
// instruction is packing pressure. Stating a target holds the line.
const BEAT_TARGET = 150;

// ---------------------------------------------------------------- claude cli

function askClaude(prompt, model = null) {
  return new Promise((res, rej) => {
    // Prompt goes over stdin, not argv — these prompts embed full synopses and
    // would blow past ARG_MAX (and mangle quoting) as a shell argument.
    // Model is left to the CLI default unless asked. This work is grounded
    // summarisation against a rigid output spec — the facts come from
    // Wikipedia and the only judgement is which events are load-bearing — so
    // it is a reasonable candidate for a cheaper tier. Whether that holds is
    // an empirical question, hence the flag.
    //
    // --tools "" disables the whole built-in set, which is required rather
    // than tidy. With tools available the CLI can decide to do the job
    // differently than asked: generating Dark Matter, it went off and tried to
    // WRITE the spine file itself, then returned the prose sentence "Wrote the
    // Dark Matter spine to ... pending your approval" instead of JSON. The
    // file was never actually created, so it reported success for work it had
    // not done. One sporadic silent failure in eighteen shows is a batch-
    // breaking rate at any real scale. This call wants a pure function:
    // prompt in, JSON out, no side effects.
    const args = ['-p', '--tools', ''];
    if (model) args.push('--model', model);
    const child = spawn('claude', args, { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('error', rej);
    child.on('close', code => (code === 0 ? res(out) : rej(new Error(`claude exited ${code}: ${err.slice(0, 400)}`))));
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/** Models like to wrap JSON in prose or fences no matter how firmly you ask. */
function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`No JSON found in response:\n${text.slice(0, 400)}`);
  return JSON.parse(candidate.slice(start, end + 1));
}

// ---------------------------------------------------------------- prompt

function buildPrompt(show, season, priorSeasons) {
  // Prefer the Wikipedia plot summary over the official synopsis. Official
  // synopses are marketing copy and are deliberately vague at exactly the
  // moments a recap needs to be specific — grounding on them produced beats
  // like "certain truths finally come to light", which is true and useless.
  const episodes = season.episodes
    .map(e => {
      const body = e.plot || e.overview || '(no summary available)';
      return `  E${e.episode} — "${e.name}"\n    ${body}`;
    })
    .join('\n');

  const priorContext = priorSeasons.length
    ? `\nThe viewer has already seen season(s) ${priorSeasons.join(', ')}. Assume that knowledge; do not re-explain it.\n`
    : '';

  return `You are writing the story spine for a TV recap. The reader finished ${show.title} season ${season.season} a long time ago and is about to watch the next season. They have forgotten almost everything.

SHOW: ${show.title}
PREMISE: ${show.overview}
SEASON ${season.season} EPISODES (plot summaries — these are your factual ground truth):
${episodes}
${priorContext}
YOUR TASK — read this carefully, it is the whole job:

Write the CAUSAL SPINE of this season, not a highlight reel.

A highlight reel picks the biggest, most memorable moments. That is NOT what you are doing, and it produces a bad recap. Someone who has forgotten the show needs the THREAD — the chain of events where each one explains the next — so they understand where every character stands when the new season opens.

"Important" and "load-bearing" are different things. A shocking, memorable event that changes nothing going forward is LESS valuable here than a quiet moment where someone realises they've been lied to. Choose for what the reader needs in order to make sense of what comes next.

Rules:
- 6 to 7 beats, chronological. They must read as a connected story, not a list. Each beat should feel like it follows from the previous one.
- A beat MAY span several episodes if that is what makes the causal link clear. Prefer merging two episodes into one coherent beat over two disconnected fragments.
- LENGTH: aim for about ${BEAT_TARGET} characters per beat; ${BEAT_CHAR_LIMIT} is a hard ceiling, not a target. Count them. Each beat is a single caption over a full-screen image, and anything longer stops being a caption and becomes a paragraph the reader skips. If a beat is running long, cut a proper noun or a clause rather than trimming words — dense beats packed with names read worse than short ones.
- Two sentences maximum per beat. Present tense. Concrete and plain — no ad-copy phrasing, no rhetorical questions, no "little does she know".
- The source summaries below are detailed, which makes it tempting to include everything. Do not. Prioritise OUTCOME over MECHANISM: what changed and what it means, not the procedural detail of how it happened. "She survives and sees dozens of other silos on the horizon" earns its space; the specifics of how her suit was sabotaged do not.
- Every factual claim must be supported by the synopses above. If you assert something you know from the show but which is NOT derivable from the synopses, you must set needsVerify true for that beat.
- anchorEpisode = the episode whose still should illustrate the beat. This is where your knowledge of the show's most striking imagery IS wanted: pick the episode with the most visually arresting moment relevant to the beat.
- Do not spoil anything beyond season ${season.season}.

Also produce, as of the END of season ${season.season}:
- cliffhanger: the unresolved situation the reader is walking back into. One or two sentences, plus 3 open questions. Pose questions; do not answer them.
- characters: the people a returning viewer must be able to recognise, and who each one IS at that exact point — their position and their current situation. One sentence each. Not their whole arc; their current state.

  Choose by the SAME test as the beats, not by screen time or billing. A person belongs here if failing to recognise them would make the next season confusing. That is a different question from "who is a main character": someone who dies at the end of this season may be essential, because the next season is about the hole they left, while a regular who drifts through without affecting anything is not.

  Two rules that are not negotiable:
  - Anyone who is central to two or more of your beats MUST have an entry. If they are load-bearing enough to carry the plot, they are load-bearing enough to introduce.
  - Do not include anyone the beats never touch and whose absence would confuse nobody. Padding the list to a round number makes the recap longer and worse.

  Use as many as the show needs and no more — typically 4 to 10. A tight two-hander genuinely has 4; a large ensemble in a season where power changes hands genuinely has 9. Order them by how badly the viewer needs them, most essential first. The set changes from season to season as people rise, die, or leave.

Return ONLY valid JSON, no commentary, in exactly this shape:

{
  "beats": [
    {
      "label": "S${season.season} · short title (3 words max)",
      "text": "Two sentences max.",
      "anchorEpisode": 4,
      "whyLoadBearing": "one line, for the human reviewer — why this beat is needed to understand what follows",
      "needsVerify": false
    }
  ],
  "cliffhanger": {
    "text": "One or two sentences.",
    "questions": ["...", "...", "..."]
  },
  "characters": [
    { "name": "Full Name", "line": "One sentence: who they are and where they stand right now.", "note": "optional short extra line, or omit" }
  ]
}`;
}

// --- whole-show prompt ------------------------------------------------------
//
// One call covering every season, instead of one call per season.
//
// This exists for a hard constraint: generation runs through the `claude` CLI
// on a subscription with rolling usage limits, so the binding cost is the
// NUMBER OF CALLS, not tokens or wall-clock. At ~4.5 seasons per show, batching
// by show cuts a 500-show run from ~2250 calls to ~500.
//
// There's a quality argument for it too: which S1 beat is load-bearing depends
// partly on what it pays off in S3, and a per-season call structurally cannot
// know that. The counter-risk is that long structured outputs degrade toward
// the end, so later seasons could come back thinner. Verified by diffing
// against a known-good per-season spine before being used for a batch.

function buildWholeShowPrompt(show) {
  const seasonBlocks = show.seasons
    .map(season => {
      const eps = season.episodes
        .map(e => `    E${e.episode} — "${e.name}"\n      ${e.plot || e.overview || '(no summary)'}`)
        .join('\n');
      return `SEASON ${season.season}:\n${eps}`;
    })
    .join('\n\n');

  const seasonList = show.seasons.map(s => s.season);

  return `You are writing story spines for a TV recap, for EVERY season of this show in one pass.

SHOW: ${show.title}
PREMISE: ${show.overview}

${seasonBlocks}

YOUR TASK — read this carefully, it is the whole job:

For EACH of seasons ${seasonList.join(', ')}, write the CAUSAL SPINE of that season — not a highlight reel.

A highlight reel picks the biggest, most memorable moments. That is NOT what you are doing, and it produces a bad recap. Someone who has forgotten the show needs the THREAD — the chain of events where each one explains the next — so they understand where every character stands when the next season opens.

"Important" and "load-bearing" are different things. A shocking, memorable event that changes nothing going forward is LESS valuable here than a quiet moment where someone realises they've been lied to.

CRITICAL — each season's entry must be written for a reader who is about to watch the season AFTER it, and who has seen everything up to and including it. So:
- Season N's beats cover ONLY season N's events.
- Season N's characters describe who everyone is AT THE END of season N — not their series-wide arc.
- Season N's cliffhanger is what is unresolved at the END of season N.
- Season N must NEVER reference anything from season N+1 or later. This is the single most important rule here: you can see later seasons in the source above, and leaking them into an earlier season's entry ruins the recap for someone who has not watched that far.

Rules for every beat:
- 6 to 7 beats per season, chronological, reading as a connected story rather than a list.
- A beat MAY span several episodes if that makes the causal link clear.
- LENGTH: aim for about ${BEAT_TARGET} characters per beat; ${BEAT_CHAR_LIMIT} is a hard ceiling, not a target. Count them. Each beat is a single caption over a full-screen image. If a beat runs long, cut a proper noun or a clause rather than trimming words — dense beats packed with names read worse than short ones.
- Two sentences maximum. Present tense. Concrete and plain — no ad-copy phrasing, no rhetorical questions, no "little does she know".
- Prioritise OUTCOME over MECHANISM: what changed and what it means, not the procedural detail of how it happened.
- Every factual claim must be supported by the summaries above. If you assert something you know from the show but which is NOT derivable from them, set needsVerify true for that beat.
- anchorEpisode = the episode within that season whose still should illustrate the beat. Pick the episode with the most visually arresting relevant moment.

WEIGHTING — this is where whole-show generation goes wrong if you let it:

Each season's entry is a LAUNCHPAD into the next season, not a summary of itself. You can see every season at once, which makes it tempting to write each one as a tidy self-contained unit. Do not. Judge every candidate beat by: does the reader need this to understand the season that FOLLOWS?

Concretely, within season N, prefer:
- a thread that is still live at the end of season N over one that resolves inside it, even if the resolved one was bigger while it ran;
- the first real appearance of a person who matters later over another development for someone already established;
- a relationship or allegiance that has just shifted over an action sequence that changes nobody's position.

A storyline that opens and closes inside season N may deserve a single beat, not three, however much screen time it had. A quiet introduction late in season N of someone who drives season N+1 is one of the most valuable beats you can spend. You know which threads continue — use that to allocate space. That is the one advantage this format has over writing each season blind, so use it for weighting, and NEVER let it leak later-season events into the text.

For each season, also produce, as of the END of that season:
- cliffhanger: the unresolved situation the reader is walking back into. One or two sentences, plus exactly 3 open questions. Pose questions; do not answer them.
- characters: the people a returning viewer must be able to recognise, and who each one IS at that exact point — their position and their current situation. One sentence each. Not their whole arc; their current state.

  Choose by the SAME test as the beats, not by screen time or billing. A person belongs here if failing to recognise them would make the next season confusing. That is a different question from "who is a main character": someone who dies at the end of this season may be essential, because the next season is about the hole they left, while a regular who drifts through without affecting anything is not.

  Two rules that are not negotiable:
  - Anyone who is central to two or more of your beats MUST have an entry. If they are load-bearing enough to carry the plot, they are load-bearing enough to introduce.
  - Do not include anyone the beats never touch and whose absence would confuse nobody. Padding the list to a round number makes the recap longer and worse.

  Use as many as the show needs and no more — typically 4 to 10. A tight two-hander genuinely has 4; a large ensemble in a season where power changes hands genuinely has 9. Order them by how badly the viewer needs them, most essential first. The set changes from season to season as people rise, die, or leave.

Give every season the SAME care. Do not let later seasons come back thinner or shorter than earlier ones.

Return ONLY valid JSON, keyed by season number:

{
  "seasons": {
${seasonList
  .map(
    n => `    "${n}": {
      "beats": [{ "label": "S${n} · short title", "text": "...", "anchorEpisode": 1, "whyLoadBearing": "...", "needsVerify": false }],
      "cliffhanger": { "text": "...", "questions": ["...", "...", "..."] },
      "characters": [{ "name": "Full Name", "line": "...", "note": "optional" }]
    }`,
  )
  .join(',\n')}
  }
}`;
}

// ---------------------------------------------------------------- validation

/** Shared post-processing for one season's payload, whichever prompt produced it. */
function validateSeason(parsed, season, label) {
  const valid = new Set(season.episodes.map(e => e.episode));
  for (const b of parsed.beats ?? []) {
    if (!valid.has(b.anchorEpisode)) {
      console.warn(`\n    ⚠ ${label} beat "${b.label}" anchors to E${b.anchorEpisode}, not in that season`);
      b.anchorEpisode = null;
    }
  }
  const long = (parsed.beats ?? []).filter(b => b.text.length > BEAT_CHAR_LIMIT);
  if (long.length) {
    console.warn(
      `\n    ⚠ ${label}: ${long.length} beat(s) over ${BEAT_CHAR_LIMIT} chars: ` +
        long.map(b => `${b.label} (${b.text.length})`).join(', '),
    );
  }
  // Character cards are a fixed-length act in the story — a season that returns
  // 11 of them turns the opening into a slog before any plot lands.
  const chars = parsed.characters?.length ?? 0;
  if (chars < 5 || chars > 7) {
    console.warn(`\n    ⚠ ${label}: ${chars} characters (expected 6)`);
  }
  return parsed;
}

// ---------------------------------------------------------------- main

async function main() {
  const argv = process.argv.slice(2);
  const slug = argv[argv.indexOf('--slug') + 1] || 'silo';
  const wholeShow = argv.includes('--whole-show');
  const model = argv.indexOf('--model') >= 0 ? argv[argv.indexOf('--model') + 1] : null;
  const outArg = argv.indexOf('--out');
  const outName = outArg >= 0 ? argv[outArg + 1] : `${slug}.spine.json`;

  const show = JSON.parse(await readFile(resolve(ROOT, `src/recap/data/${slug}.json`), 'utf8'));

  // Bound generation to the seasons we can honestly write.
  //
  // The dataset holds every season, but Wikipedia lags broadcast, so the most
  // recent season is often barely summarised. Generating it anyway produces a
  // confident wrong recap rather than a thin one. The batch runner passes the
  // usable bound from eligibility; a lone run defaults to everything fetched.
  const throughArg = argv.indexOf('--through') >= 0 ? Number(argv[argv.indexOf('--through') + 1]) : null;
  if (throughArg) {
    const before = show.seasons.length;
    show.seasons = show.seasons.filter(s => s.season <= throughArg);
    if (show.seasons.length < before) {
      console.log(`  (bounded to S1-S${throughArg} of ${before} fetched)`);
    }
  }
  // Generate only from this season on, merging into whatever the spine already
  // holds.
  //
  // Without this, adding a season means regenerating the whole show, which
  // rewrites text that has already been reviewed and shipped — so the cheap,
  // safe operation (one new season) carried the cost and risk of the expensive
  // one, and nobody ran it. Prior seasons still supply CONTEXT below; they are
  // just not re-asked for.
  const fromArg = argv.indexOf('--from') >= 0 ? Number(argv[argv.indexOf('--from') + 1]) : null;
  if (fromArg && wholeShow) {
    throw new Error('--from and --whole-show are incompatible: the whole-show call rewrites every season by definition');
  }

  const path = resolve(ROOT, `src/recap/data/${outName}`);
  const out = { slug, generatedFor: show.title, seasons: {} };

  // Seed from the existing spine so untargeted seasons survive byte-identically.
  // EVERY existing season is carried, not just those below --from; the targets
  // overwrite their own entries below. Seeding only the seasons under --from
  // would silently drop anything above the range — regenerating S3 of a spine
  // holding S1 and S5 would take S5 with it.
  if (fromArg) {
    const existing = JSON.parse(await readFile(path, 'utf8').catch(() => 'null'));
    if (existing?.seasons) {
      for (const [n, v] of Object.entries(existing.seasons)) out.seasons[n] = v;
      const kept = Object.keys(out.seasons);
      if (kept.length) console.log(`  (carrying existing S${kept.join(',S')})`);
    }
  }

  const targets = show.seasons.filter(s => !fromArg || s.season >= fromArg);
  if (!targets.length) throw new Error(`no seasons to generate (--from ${fromArg}, --through ${throughArg})`);

  console.log(
    `\n▸ Generating spine for "${show.title}" (${show.seasons.length} seasons fetched, ` +
      `generating S${targets.map(s => s.season).join(',S')})` +
      `${wholeShow ? ' — whole-show mode, 1 call' : ''}${model ? ` — model ${model}` : ''}\n`,
  );

  if (wholeShow) {
    process.stdout.write('  all seasons … ');
    const parsed = extractJSON(await askClaude(buildWholeShowPrompt(show), model));
    for (const season of targets) {
      const entry = parsed.seasons?.[String(season.season)];
      if (!entry) continue;
      out.seasons[season.season] = validateSeason(entry, season, `S${season.season}`);
    }
    const counts = Object.entries(out.seasons)
      .map(([n, v]) => `S${n}:${v.beats?.length ?? 0}b/${v.characters?.length ?? 0}c`)
      .join(' ');
    console.log(counts);
  } else {
    for (const season of targets) {
      // Prior context comes from the full fetched set, not from `targets` — an
      // incremental run for S5 must still know that S1-S4 happened.
      const prior = show.seasons.filter(s => s.season < season.season).map(s => s.season);
      process.stdout.write(`  S${season.season} … `);
      const parsed = validateSeason(
        extractJSON(await askClaude(buildPrompt(show, season, prior), model)),
        season,
        `S${season.season}`,
      );
      out.seasons[season.season] = parsed;
      const flagged = (parsed.beats ?? []).filter(b => b.needsVerify).length;
      console.log(`${parsed.beats?.length ?? 0} beats, ${parsed.characters?.length ?? 0} characters, ${flagged} flagged for verify`);
    }
  }

  // Every season we asked for must have come back. This used to `continue` past
  // a missing season with a warning, which in a 500-show batch scrolled away
  // unread — and the file still wrote, and upload still set through_season to
  // whatever arrived. 145 seasons across 66 shows went missing that way, all of
  // them looking downstream like shows that simply have fewer seasons.
  const missing = targets.map(s => s.season).filter(n => !out.seasons[n]);
  if (missing.length) {
    throw new Error(
      `S${missing.join(', S')} missing from the response — asked for ` +
        `${targets.length} season(s), got ${targets.length - missing.length}. ` +
        `Nothing written; re-run${wholeShow ? ' (whole-show mode drops seasons under length pressure; try per-season)' : ''}.`,
    );
  }

  // Temp-and-rename: an incremental run holds already-approved seasons in this
  // same file, so a partial write would corrupt shipped content.
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(out, null, 2));
  await rename(tmp, path);
  console.log(`\n✓ ${path} (S${Object.keys(out.seasons).join(',S')})\n`);
}

main().catch(err => {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
});
