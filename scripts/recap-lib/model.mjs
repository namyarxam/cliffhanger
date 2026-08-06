// The single place the pipeline talks to a model.
//
// Runs through the authenticated `claude` CLI on the user's subscription, so
// the binding cost is the NUMBER OF CALLS, not tokens. Every caller should be
// designed around that: one call per season for generation, one per season for
// verification, and verification verdicts cached by content hash so re-runs
// spend nothing (see verify.mjs).
//
// `--tools ""` disables the whole built-in tool set, which is required rather
// than tidy: with tools available the CLI can decide to do the job differently
// than asked — it once tried to WRITE the output file itself, failed, and
// returned prose reporting success for work it had not done. This call wants a
// pure function: prompt in, JSON out, no side effects.

import { spawn } from 'node:child_process';
import { ROOT } from './env.mjs';

export function askClaude(prompt, model = null) {
  return new Promise((res, rej) => {
    // Prompt goes over stdin, not argv — these prompts embed full episode
    // summaries and would blow past ARG_MAX as a shell argument.
    const args = ['-p', '--tools', ''];
    if (model) args.push('--model', model);
    const child = spawn('claude', args, { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('error', rej);
    child.on('close', code =>
      code === 0 ? res(out) : rej(new Error(`claude exited ${code}: ${err.slice(0, 400)}`)),
    );
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/** Models like to wrap JSON in prose or fences no matter how firmly you ask. */
export function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`No JSON found in response:\n${text.slice(0, 400)}`);
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Ask for JSON that passes a deterministic validator, re-asking once with the
 * validator's errors appended before giving up.
 *
 * This is the subscription-path substitute for API structured outputs: the
 * schema cannot be enforced by the transport, so it is enforced here — a
 * malformed response costs one retry call, never a malformed row downstream.
 * The validator returns an array of problem strings; empty means valid.
 */
export async function askValidated(prompt, validate, model = null, label = 'response') {
  let parsed = extractJSON(await askClaude(prompt, model));
  let problems = validate(parsed);
  if (!problems.length) return parsed;

  console.warn(`    ⚠ ${label} failed validation (${problems.length} problem(s)), re-asking once`);
  const retryPrompt =
    `${prompt}\n\nYOUR PREVIOUS ATTEMPT FAILED VALIDATION. The exact problems:\n` +
    problems.map(p => `- ${p}`).join('\n') +
    `\n\nReturn the corrected JSON, complete, in the exact shape asked for. Fix ONLY these problems; keep everything else identical.`;
  parsed = extractJSON(await askClaude(retryPrompt, model));
  problems = validate(parsed);
  if (problems.length) {
    throw new Error(`${label} failed validation after retry:\n  ${problems.join('\n  ')}`);
  }
  return parsed;
}
