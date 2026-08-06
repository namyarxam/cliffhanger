// Judgement: which events are load-bearing, in what order they explain each
// other, and which episode illustrates each beat.
//
// THE CENTRAL DESIGN DECISION (unchanged from the first library build): we do
// NOT ask for "the most important scenes". A highlight reel optimises for
// peaks; a recap optimises for comprehension — the causal thread a returning
// viewer needs. Facts stay grounded in the fetched summaries; anything the
// model asserts that isn't derivable from them must be flagged needsVerify.
//
// Two generation shapes, both ported from generate-spine.mjs:
//   - whole-show: one call for every season. Chosen for `add` because on a
//     subscription the binding cost is the NUMBER OF CALLS, and because which
//     S1 beat is load-bearing depends partly on what it pays off in S3.
//   - per-season: one call per season with prior-season context. Used by
//     `extend`, where regenerating shipped seasons would rewrite reviewed text.
//
// Validation here is deterministic and runs through askValidated, so a
// malformed response costs one retry call, never a malformed season downstream.

import { askValidated } from './model.mjs';

// Beat captions render over a full-screen image; past this they stop reading
// as captions. Used in both the prompt and the check so the two can't drift.
export const BEAT_CHAR_LIMIT = 180;
// Measured: the hand-reviewed spine that read best averaged ~150. Stating a
// target holds the line; a ceiling alone drifts output toward it.
const BEAT_TARGET = 150;
// Anything past this is a hard failure worth a retry, not a warning.
const BEAT_HARD_LIMIT = 260;

// ---------------------------------------------------------------- prompts

function episodeBlock(season) {
  return season.episodes
    .map(e => {
      const body = e.plot || e.overview || '(no summary available)';
      return `  E${e.episode} — "${e.name}"\n    ${body}`;
    })
    .join('\n');
}

const SPINE_RULES = (seasonWord, target, limit) => `Rules:
- 6 to 7 beats${seasonWord ? ` per season` : ''}, chronological. They must read as a connected story, not a list. Each beat should feel like it follows from the previous one.
- A beat MAY span several episodes if that is what makes the causal link clear. Prefer merging two episodes into one coherent beat over two disconnected fragments.
- LENGTH: aim for about ${target} characters per beat; ${limit} is a hard ceiling, not a target. Count them. Each beat is a single caption over a full-screen image, and anything longer stops being a caption and becomes a paragraph the reader skips. If a beat is running long, cut a proper noun or a clause rather than trimming words — dense beats packed with names read worse than short ones.
- Two sentences maximum per beat. Present tense. Concrete and plain — no ad-copy phrasing, no rhetorical questions, no "little does she know".
- Prioritise OUTCOME over MECHANISM: what changed and what it means, not the procedural detail of how it happened.
- Every factual claim must be supported by the episode summaries above. If you assert something you know from the show but which is NOT derivable from the summaries, you must set needsVerify true for that beat.
- anchorEpisode = the episode whose still should illustrate the beat. This is where your knowledge of the show's most striking imagery IS wanted: pick the episode with the most visually arresting moment relevant to the beat.`;

const CHARACTER_RULES = `- characters: the people a returning viewer must be able to recognise, and who each one IS at that exact point — their position and their current situation. One sentence each. Not their whole arc; their current state.

  Choose by the SAME test as the beats, not by screen time or billing. A person belongs here if failing to recognise them would make the next season confusing: someone who dies at the end of this season may be essential, because the next season is about the hole they left, while a regular who drifts through without affecting anything is not.

  Two rules that are not negotiable:
  - Anyone who is central to two or more of your beats MUST have an entry. If they are load-bearing enough to carry the plot, they are load-bearing enough to introduce.
  - Do not include anyone the beats never touch and whose absence would confuse nobody. Padding the list to a round number makes the recap longer and worse.

  Use as many as the show needs and no more — typically 4 to 10. Order them by how badly the viewer needs them, most essential first. The set changes from season to season as people rise, die, or leave.`;

export function buildSeasonPrompt(show, season, priorSeasons) {
  const priorContext = priorSeasons.length
    ? `\nThe viewer has already seen season(s) ${priorSeasons.join(', ')}. Assume that knowledge; do not re-explain it.\n`
    : '';

  return `You are writing the story spine for a TV recap. The reader finished ${show.title} season ${season.season} a long time ago and is about to watch the next season. They have forgotten almost everything.

SHOW: ${show.title}
PREMISE: ${show.overview}
SEASON ${season.season} EPISODES (plot summaries — these are your factual ground truth):
${episodeBlock(season)}
${priorContext}
YOUR TASK — read this carefully, it is the whole job:

Write the CAUSAL SPINE of this season, not a highlight reel.

A highlight reel picks the biggest, most memorable moments. That is NOT what you are doing, and it produces a bad recap. Someone who has forgotten the show needs the THREAD — the chain of events where each one explains the next — so they understand where every character stands when the new season opens.

"Important" and "load-bearing" are different things. A shocking, memorable event that changes nothing going forward is LESS valuable here than a quiet moment where someone realises they've been lied to.

${SPINE_RULES(false, BEAT_TARGET, BEAT_CHAR_LIMIT)}
- Do not spoil anything beyond season ${season.season}.

Also produce, as of the END of season ${season.season}:
- cliffhanger: the unresolved situation the reader is walking back into. One or two sentences, plus exactly 3 open questions. Pose questions; do not answer them.
${CHARACTER_RULES}

Return ONLY valid JSON, no commentary, in exactly this shape:

{
  "beats": [
    {
      "label": "S${season.season} · short title (3 words max)",
      "text": "Two sentences max.",
      "anchorEpisode": 4,
      "whyLoadBearing": "one line, for the human reviewer",
      "needsVerify": false
    }
  ],
  "cliffhanger": { "text": "One or two sentences.", "questions": ["...", "...", "..."] },
  "characters": [
    { "name": "Full Name", "line": "One sentence: who they are and where they stand right now.", "note": "optional short extra line, or omit" }
  ]
}`;
}

export function buildWholeShowPrompt(show) {
  const seasonBlocks = show.seasons
    .map(season => `SEASON ${season.season}:\n${episodeBlock(season)}`)
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

${SPINE_RULES(true, BEAT_TARGET, BEAT_CHAR_LIMIT)}

WEIGHTING — this is where whole-show generation goes wrong if you let it:

Each season's entry is a LAUNCHPAD into the next season, not a summary of itself. You can see every season at once, which makes it tempting to write each one as a tidy self-contained unit. Do not. Judge every candidate beat by: does the reader need this to understand the season that FOLLOWS?

Concretely, within season N, prefer:
- a thread that is still live at the end of season N over one that resolves inside it, even if the resolved one was bigger while it ran;
- the first real appearance of a person who matters later over another development for someone already established;
- a relationship or allegiance that has just shifted over an action sequence that changes nobody's position.

A storyline that opens and closes inside season N may deserve a single beat, not three. A quiet introduction late in season N of someone who drives season N+1 is one of the most valuable beats you can spend. You know which threads continue — use that for weighting, and NEVER let it leak later-season events into the text.

For each season, also produce, as of the END of that season:
- cliffhanger: the unresolved situation the reader is walking back into. One or two sentences, plus exactly 3 open questions. Pose questions; do not answer them.
${CHARACTER_RULES}

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

/**
 * Hard problems with one season's entry — the kind worth spending a retry
 * call on. Returns problem strings; empty means valid.
 */
export function seasonProblems(entry, seasonLabel) {
  const p = [];
  if (!entry || typeof entry !== 'object') return [`${seasonLabel}: entry missing or not an object`];
  const beats = entry.beats;
  if (!Array.isArray(beats) || beats.length < 4 || beats.length > 9) {
    p.push(`${seasonLabel}: expected 6-7 beats, got ${Array.isArray(beats) ? beats.length : 'none'}`);
  }
  for (const [i, b] of (beats ?? []).entries()) {
    if (!b?.label || typeof b.label !== 'string') p.push(`${seasonLabel} beat ${i + 1}: missing label`);
    if (!b?.text || typeof b.text !== 'string') p.push(`${seasonLabel} beat ${i + 1}: missing text`);
    else if (b.text.length > BEAT_HARD_LIMIT)
      p.push(`${seasonLabel} beat ${i + 1}: ${b.text.length} chars — far over the ${BEAT_CHAR_LIMIT}-char ceiling; rewrite it shorter`);
  }
  if (!entry.cliffhanger?.text || typeof entry.cliffhanger.text !== 'string') {
    p.push(`${seasonLabel}: cliffhanger.text missing`);
  }
  const q = entry.cliffhanger?.questions;
  if (!Array.isArray(q) || q.length < 2 || q.length > 4) {
    p.push(`${seasonLabel}: expected exactly 3 cliffhanger questions, got ${Array.isArray(q) ? q.length : 'none'}`);
  }
  const chars = entry.characters;
  if (!Array.isArray(chars) || chars.length < 3 || chars.length > 12) {
    p.push(`${seasonLabel}: expected 4-10 characters, got ${Array.isArray(chars) ? chars.length : 'none'}`);
  }
  for (const [i, c] of (chars ?? []).entries()) {
    if (!c?.name || typeof c.name !== 'string') p.push(`${seasonLabel} character ${i + 1}: missing name`);
    if (!c?.line || typeof c.line !== 'string') p.push(`${seasonLabel} character ${i + 1}: missing line`);
  }
  return p;
}

/** Soft cleanup + warnings that are not worth a retry call. */
export function normalizeSeason(entry, season, label) {
  const valid = new Set(season.episodes.map(e => e.episode));
  for (const b of entry.beats ?? []) {
    if (b.anchorEpisode != null && !valid.has(b.anchorEpisode)) {
      console.warn(`    ⚠ ${label} beat "${b.label}" anchors to E${b.anchorEpisode}, not in that season`);
      b.anchorEpisode = null;
    }
  }
  const long = (entry.beats ?? []).filter(b => b.text.length > BEAT_CHAR_LIMIT);
  if (long.length) {
    console.warn(
      `    ⚠ ${label}: ${long.length} beat(s) over ${BEAT_CHAR_LIMIT} chars: ` +
        long.map(b => `${b.label} (${b.text.length})`).join(', '),
    );
  }
  const chars = entry.characters?.length ?? 0;
  if (chars < 4 || chars > 8) console.warn(`    ⚠ ${label}: ${chars} characters (typical is 5-8)`);
  return entry;
}

// ---------------------------------------------------------------- generate

/**
 * Generate spine entries for `targets` (season objects from the fetched data).
 * Returns { [seasonNumber]: entry }.
 *
 * Every requested season must come back — a missing season is a thrown error,
 * never a warning. The first library build lost 145 seasons across 66 shows to
 * a `continue`-past-it warning, all of them looking downstream like shows that
 * simply had fewer seasons.
 */
export async function generateSpine({ data, targets, wholeShow, model = null }) {
  const out = {};

  if (wholeShow) {
    const showForPrompt = { ...data, seasons: targets };
    process.stdout.write(`  generating S${targets.map(s => s.season).join(',S')} (1 call) … `);
    const validate = parsed => {
      const p = [];
      for (const season of targets) {
        const entry = parsed?.seasons?.[String(season.season)];
        if (!entry) {
          p.push(`season ${season.season} is missing from the response entirely`);
          continue;
        }
        p.push(...seasonProblems(entry, `S${season.season}`));
      }
      return p;
    };
    const parsed = await askValidated(buildWholeShowPrompt(showForPrompt), validate, model, 'whole-show spine');
    for (const season of targets) {
      out[season.season] = normalizeSeason(
        parsed.seasons[String(season.season)],
        season,
        `S${season.season}`,
      );
    }
    console.log(
      Object.entries(out)
        .map(([n, v]) => `S${n}:${v.beats.length}b/${v.characters.length}c`)
        .join(' '),
    );
  } else {
    for (const season of targets) {
      const prior = data.seasons.filter(s => s.season < season.season).map(s => s.season);
      process.stdout.write(`  generating S${season.season} … `);
      const validate = parsed => seasonProblems(parsed, `S${season.season}`);
      const parsed = await askValidated(
        buildSeasonPrompt(data, season, prior),
        validate,
        model,
        `S${season.season} spine`,
      );
      out[season.season] = normalizeSeason(parsed, season, `S${season.season}`);
      const flagged = out[season.season].beats.filter(b => b.needsVerify).length;
      console.log(
        `${out[season.season].beats.length} beats, ${out[season.season].characters.length} characters, ${flagged} self-flagged`,
      );
    }
  }

  const missing = targets.map(s => s.season).filter(n => !out[n]);
  if (missing.length) {
    throw new Error(`S${missing.join(', S')} missing after generation — refusing to continue`);
  }
  return out;
}
