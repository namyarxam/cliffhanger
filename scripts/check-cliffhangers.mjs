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

import { readFile, writeFile, readdir } from 'node:fs/promises';
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

Do NOT flag: compression, dramatic phrasing, or a reasonable reading of what the source implies. Only flag what the source actually contradicts or never supports. When you cannot point to specific source text, do not flag it.

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
      jobs.push({ slug, title: data.title, season: Number(n), eps, cliff });
    }
  }
  console.log(`\n  ${jobs.length} cliffhangers across ${slugs.length} shows\n`);

  const results = await mapLimit(jobs, CONCURRENCY, async job => {
    try {
      const parsed = extractJSON(await askClaude(buildPrompt(job.title, job.season, job.eps, job.cliff)));
      const flags = parsed.flags ?? [];
      if (flags.length) {
        console.log(`  ${job.slug} S${job.season} — ${flags.length} flag(s)`);
        for (const f of flags) console.log(`      [${f.kind}] ${f.claim}`);
      }
      return { ...job, eps: undefined, flags };
    } catch (e) {
      // A rate-limited or malformed run records nothing rather than a false clean.
      console.log(`  ${job.slug} S${job.season} — ERROR ${e.message.slice(0, 60)}`);
      return { slug: job.slug, season: job.season, error: e.message };
    }
  });

  const flagged = results.filter(r => r.flags?.length);
  const errored = results.filter(r => r.error);
  await writeFile(
    resolve(DATA, '_cliffhanger-check.json'),
    JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2),
  );
  console.log(`\n  ${results.length - errored.length} checked · ${flagged.length} with flags · ${errored.length} errored`);
  console.log(`  written to src/recap/data/_cliffhanger-check.json\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
