#!/usr/bin/env node
/**
 * Check every season cliffhanger against that season's source, on its own.
 *
 * WHY CLIFFHANGERS GET A DEDICATED PASS
 *
 * They are the last thing a reader sees before deciding whether they are
 * caught up, and there are only ~800 in the whole library — the highest
 * weight per item of anything we ship, and few enough to check hard.
 *
 * They also fail differently from beats. A beat narrates an event; a
 * cliffhanger asserts a STATE — who knows what, who is still alive, what is
 * still hidden. State claims invert cleanly and invisibly: Snowfall's season 3
 * cliffhanger said Franklin's knowledge of Teddy's CIA identity was "still
 * buried" when the season ends with him saying it out loud and using it as
 * leverage. Every word around it was true. The general audit found that one,
 * but it is looking at forty other items in the same call; this looks at one.
 *
 * The prompt therefore probes the three shapes that actually go wrong:
 * negation ("still", "not yet", "does not know"), exclusivity ("the only",
 * "no one else"), and status (alive/dead, free/held, hidden/exposed).
 *
 * Usage:
 *   node scripts/check-cliffhangers.mjs --slug snowfall
 *   node scripts/check-cliffhangers.mjs --all
 *   node scripts/check-cliffhangers.mjs --all --limit 10
 */

import { readFile, writeFile, readdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'src/recap/data');

const arg = (f, d = null) => {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : d;
};
const CONCURRENCY = Number(arg('--concurrency', 6));

async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await worker(items[i], i);
      }
    }),
  );
  return out;
}

function askClaude(prompt) {
  return new Promise((res, rej) => {
    // --tools '' matters: with tools available the CLI goes agentic and returns prose.
    const child = spawn('claude', ['-p', '--tools', ''], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('error', rej);
    child.on('close', c => (c === 0 ? res(out) : rej(new Error(`claude exited ${c}: ${err.slice(0, 200)}`))));
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const c = fenced ? fenced[1] : text;
  const a = c.indexOf('{'), b = c.lastIndexOf('}');
  if (a === -1) throw new Error('no JSON in response');
  return JSON.parse(c.slice(a, b + 1));
}

const buildPrompt = (title, seasonNo, episodes, cliff) => `You are checking ONE sentence-or-two summary against the plot summaries it was written from.

SOURCE — official episode plot summaries for ${title} season ${seasonNo}, and the ONLY thing that counts as evidence:

${episodes.map(e => `[E${e.episode}] ${e.name ?? ''}\n${(e.plot || e.overview || '').trim()}`).join('\n\n')}

THE TEXT UNDER REVIEW. It is meant to state where things stand AT THE END of this season, for someone deciding whether they are caught up:

"${cliff}"

Check every claim it makes about the state of things. Pay particular attention to the three ways this kind of text goes wrong:

1. NEGATION — "still hidden", "does not yet know", "has not told anyone". Check the source for the moment it stops being true. A season very often ends by REVEALING the thing, and a summary written from memory says it is still secret.
2. EXCLUSIVITY — "the only person who knows", "no one else has seen it". Check whether the source gives that knowledge to somebody else too.
3. STATUS — alive/dead, free/captured, in power/deposed, together/separated. Check each named person's actual position at season's end.

Also flag anyone named here whom the source for THIS season never mentions.

A CONTRADICTION is not the same as an OMISSION, and only contradictions count.

If the text names a year, a place or a detail the source simply does not mention, that is compression — the recap is allowed to be more specific than the summary. Say nothing. Only flag a detail when the source states something INCOMPATIBLE with it.

The one exception is a PERSON the source for this season never mentions at all, which is worth knowing about even without a contradiction. Flag that as unknown_name.

Also do not flag: dramatic phrasing, or a reasonable reading of what the source clearly implies.

The two errors do not cost the same. A missed flag leaves one wrong sentence. A false flag sends someone to re-read a season that was fine, and enough of those make the whole report worth ignoring. If you cannot quote the source text that makes the claim false, do not flag it.

Return ONLY valid JSON. An empty array is a valid and expected answer:

{
  "flags": [
    {
      "kind": "negation | exclusivity | status | unknown_name",
      "claim": "the exact phrase from the text that is wrong",
      "evidence": "the source sentence that contradicts it, quoted",
      "correction": "what is actually true at the end of this season"
    }
  ]
}`;

async function main() {
  let slugs = process.argv.includes('--all')
    ? (await readdir(DATA))
        .filter(f => f.endsWith('.spine.json') && !f.includes('bak'))
        .map(f => f.replace('.spine.json', ''))
        .sort()
    : [arg('--slug')].filter(Boolean);
  if (!slugs.length) {
    console.error('\n✗ pass --slug <name> or --all\n');
    process.exit(1);
  }
  const limit = Number(arg('--limit', 0));
  if (limit) slugs = slugs.slice(0, limit);

  /**
   * Resume support. An 800-call sweep does not survive a usage window, and the
   * results used to be written only after the last call returned — so a run
   * killed at 700 threw away 700 calls. Prior results are loaded, already-checked
   * seasons are skipped, and every result is flushed as it lands.
   *
   * An ERRORED season is deliberately not treated as checked: a rate-limited
   * call must be retried, not frozen in as a clean result.
   */
  const OUT = resolve(DATA, '_cliffhanger-check.json');
  let prior = [];
  try {
    prior = JSON.parse(await readFile(OUT, 'utf8')).results ?? [];
  } catch { /* first run */ }
  const done = new Map();
  for (const r of prior) if (!r.error) done.set(`${r.slug}|${r.season}`, r);

  const jobs = [];
  for (const slug of slugs) {
    if (!existsSync(resolve(DATA, `${slug}.spine.json`))) continue;
    const spine = JSON.parse(await readFile(resolve(DATA, `${slug}.spine.json`), 'utf8'));
    const data = JSON.parse(await readFile(resolve(DATA, `${slug}.json`), 'utf8'));
    for (const [n, entry] of Object.entries(spine.seasons)) {
      const cliff = entry.cliffhanger?.text;
      if (!cliff) continue;
      const eps = (data.seasons.find(s => s.season === Number(n))?.episodes ?? [])
        .filter(e => (e.plot || e.overview || '').length > 80);
      if (eps.length < 2) continue;
      if (done.has(`${slug}|${Number(n)}`) && !process.argv.includes('--force')) continue;
      jobs.push({ slug, title: data.title, season: Number(n), eps, cliff });
    }
  }
  console.log(`\n  ${jobs.length} cliffhangers to check across ${slugs.length} shows` +
    `${done.size ? ` (${done.size} already done, resuming)` : ''}\n`);

  // Flushed as results land, so a killed run keeps everything it paid for.
  //
  // Serialised and atomic, because neither is optional here: six workers can
  // reach the flush at the same moment, and two concurrent writeFiles to one
  // path interleave into unparseable JSON — which would throw away the whole
  // run at the exact moment the file exists to prevent that. Writing to a temp
  // file and renaming means a crash mid-write leaves the previous good file.
  const collected = [...done.values()];
  let sinceFlush = 0;
  let writing = Promise.resolve();
  const flush = () => {
    sinceFlush = 0;
    writing = writing.then(async () => {
      const tmp = `${OUT}.tmp`;
      await writeFile(tmp, JSON.stringify({ checkedAt: new Date().toISOString(), results: collected }, null, 2));
      await rename(tmp, OUT);
    }).catch(e => console.error(`  ✗ flush failed: ${e.message}`));
    return writing;
  };

  /**
   * Stop cleanly at the usage cap instead of failing 350 jobs in ten seconds.
   *
   * Without this the run "completes" with hundreds of errors and reads exactly
   * like a finished sweep. Errored seasons are never cached, so everything
   * stopped here is simply retried on the next run.
   */
  let consecutiveErrors = 0;
  let stopped = false;

  const results = await mapLimit(jobs, CONCURRENCY, async job => {
    if (stopped) return { slug: job.slug, season: job.season, error: 'skipped — run stopped' };
    try {
      const parsed = extractJSON(await askClaude(buildPrompt(job.title, job.season, job.eps, job.cliff)));
      const flags = parsed.flags ?? [];
      if (flags.length) {
        console.log(`  ${job.slug} S${job.season} — ${flags.length} flag(s)`);
        for (const f of flags) console.log(`      [${f.kind}] ${f.claim}`);
      }
      consecutiveErrors = 0;
      const rec = { slug: job.slug, season: job.season, cliff: job.cliff, flags };
      collected.push(rec);
      if (++sinceFlush >= 5) await flush();
      return rec;
    } catch (e) {
      // A rate-limited or malformed run records an error, never a false clean,
      // so a resume retries it instead of trusting it.
      console.log(`  ${job.slug} S${job.season} — ERROR ${e.message.slice(0, 60)}`);
      if (++consecutiveErrors >= 8 && !stopped) {
        stopped = true;
        console.log(`\n  ✋ 8 failures in a row — assuming the usage cap. Stopping cleanly.`);
        console.log(`     Nothing is lost: errored seasons are not cached, so re-running resumes here.\n`);
      }
      const rec = { slug: job.slug, season: job.season, error: e.message };
      collected.push(rec);
      if (++sinceFlush >= 5) await flush();
      return rec;
    }
  });

  await flush();
  await writing;
  const flagged = collected.filter(r => r.flags?.length);
  const errored = collected.filter(r => r.error);
  if (stopped) console.log(`\n  STOPPED EARLY at the usage cap — re-run to continue.`);
  console.log(`\n  ${collected.length - errored.length} checked · ${flagged.length} with flags · ${errored.length} errored`);
  console.log(`  written to src/recap/data/_cliffhanger-check.json\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
