# Recap Library — Handoff (paste into a new chat to continue)

You're continuing an offline pipeline that generates + QAs a library of TV show
"recaps" for the Cliffhanger app. Everything runs offline via the `claude -p`
CLI (uses the user's Claude subscription, so it's usage-limit sensitive) and
Supabase. Nothing here runs on-device.

## Current state (update by running the status command below)

- **307 shows** in `scripts/batch-manifest.json`
- **~221 have spines**; **86 rejected** at eligibility (anthology / too-thin source / one-season-mini / too-big) — no spine, correctly excluded
- Of the spined shows: **~134 clean (shippable) · ~87 flagged · 0 need-reaudit**
- **79 recaps LIVE** in Supabase; the other clean shows are repaired but NOT uploaded yet
- Branch `feat/recap`, latest commit around `43bfd08`

## The pipeline (per show)

1. `fetch-recap.mjs` → `<slug>.json`  (TVMaze+TMDB+Wikipedia, **HTTP only, 0 tokens**)
2. `generate-spine.mjs --whole-show` → `<slug>.spine.json`  (1 LLM call/show)
3. `audit-spine.mjs` → `<slug>.audit.json`  (per-season source-grounded fact-check)
4. `repair-flags.mjs --high-only`  (rewrites only flagged beats, grounded in source)
5. `upload-recap.mjs` → Supabase  (**composition only, 0 tokens**)

## THE driver — one command does everything, resumable

```bash
cd ~/dev/cliffhanger-mobile && bash scripts/finish-recaps.sh
```

- Self-prunes headless session logs at start (line-count <20 — can never touch a real session)
- Phase 1: `audit-spine --all` (restores anything un-audited; skips complete audits)
- Phase 2: `repair-pass.mjs` (repairs flagged **best-first**, re-audits **only changed seasons**)
- Prints `clean | flagged | need-reaudit` at the end
- **Re-run it after every stop** — each run resumes and makes forward progress. Safe across quota windows and random stops.

## Other commands

```bash
# status (read-only)
node -e 'const fs=require("fs"),D="src/recap/data";const man=new Set(JSON.parse(fs.readFileSync("scripts/batch-manifest.json")).shows.map(s=>s.slug));let c=0,mi=0,mo=0,h=0,re=0,ns=0;for(const s of man){if(!fs.existsSync(`${D}/${s}.spine.json`)){ns++;continue}const p=`${D}/${s}.audit.json`;if(!fs.existsSync(p)){re++;continue}try{const a=JSON.parse(fs.readFileSync(p));if((a.results||[]).some(r=>r.error)){re++;continue}let n=0;for(const r of a.results)for(const x of r.flags||[])if(x.severity==="high")n++;n===0?c++:n<=2?mi++:n<=5?mo++:h++}catch{re++}}console.log(`clean ${c} | minor ${mi} | moderate ${mo} | heavy ${h} | need-reaudit ${re} | rejected ${ns}`)'

# ship all clean shows (FREE, 0 tokens) — uploads any clean-audit show not yet live
node -e 'const fs=require("fs"),D="src/recap/data",{execSync}=require("child_process");const man=new Set(JSON.parse(fs.readFileSync("scripts/batch-manifest.json")).shows.map(s=>s.slug));for(const s of man){const p=`${D}/${s}.audit.json`;if(!fs.existsSync(`${D}/${s}.spine.json`)||!fs.existsSync(p))continue;try{const a=JSON.parse(fs.readFileSync(p));if((a.results||[]).some(r=>r.error))continue;let h=0;for(const r of a.results)for(const x of r.flags||[])if(x.severity==="high")h++;if(h===0){try{execSync(`node scripts/upload-recap.mjs --slug ${s}`,{stdio:"pipe"});console.log("uploaded",s)}catch(e){console.log("FAIL",s)}}}catch{}}'

# single show
node scripts/audit-spine.mjs  --slug <slug>            # re-audit (whole show)
node scripts/audit-spine.mjs  --slug <slug> --season 2,3   # re-audit only some seasons (MERGES)
node scripts/repair-flags.mjs --slug <slug> --high-only
node scripts/upload-recap.mjs --slug <slug>
```

## Safety properties (all built-in — the point of the recent work)

- **No clobbering.** `audit-spine` NEVER overwrites a *complete* audit with a rate-limited/errored one; a partial `--season` re-audit MERGES (other seasons preserved). Verified via dry-run.
- **Airtight cap-stop.** Both scripts stop cleanly at the usage cap. `audit-spine` circuit-breaks after 3 consecutive all-errored shows. `repair-pass` stops at the first rate-limit signal and records nothing on a failed audit.
- **Resumable / random-stop safe.** All state on disk (`_batch-state.json`, `_repair-state.json`, `*.audit.json`). Kill anytime; re-run the driver. Commit often.
- **Self-pruning** session logs (no more 5,000-file pileup).
- **Best-first + accuracy-first drops.** Repair does fewest-flag shows first (max shippable/token). A show still flagged after `MAX_ROUNDS=2` → STUCK → **drop, never ship inaccurate**. `repair-pass --max-high N` bounds the bucket.

## Decisions — do NOT relitigate

- **Per-season audit only.** Whole-show audit was tested and REJECTED (missed 75% of flags on a 5-season show). Haiku audit rejected too (loses flags). **Accuracy > tokens, always.**
- **Dropped:** `luther` (fetcher pulled wrong S2–S5 source), `the-shield` (thin source → model fabricates). Removed from manifest + disk.
- `name-match.mjs` is the single tokenizer shared by fetch/upload/audit (short-name + `(voice)` fix — makes animated character cards resolve, e.g. Arcane's Vi).
- Episode caps in `eligibility.mjs`: 120 usable / 150 total.

## Gotchas

- **Usage-limit sensitive** (user on a plan with a WEEKLY cap; audit/repair are token-heavy). Uploading is FREE. Don't waste quota; best-first already maximizes shippable/token.
- **Never launch a background bash with `&` AND `run_in_background:true`** — it double-backgrounds and orphans the process from tracking. Use `run_in_background:true` alone.
- `upload-recap.mjs` needs `SUPABASE_SERVICE_ROLE_KEY` (in `.env`, gitignored — never `EXPO_PUBLIC_` prefix it).
- Migrations applied manually via Supabase Dashboard, never `db push`.
- **User is mid-Season 5 of The Expanse and has NOT seen S6 — no plot spoilers for unwatched content.**

## Next steps

1. `bash scripts/finish-recaps.sh` across quota windows until `flagged` → 0.
2. Upload newly-clean shows (free command above).
3. Shows STUCK after 2 rounds → decide drop vs. hand-fix.
4. Deferred: request-a-show UI (tables exist); a manual Shield spine from richer source.
