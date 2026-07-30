#!/bin/bash
# Finish the recap list, accuracy-first. Per-season audit (whole-show rejected:
# it missed 75% of flags on a 5-season show). Both phases are airtight (stop
# clean at the usage cap, never clobber) and resumable — just re-run to continue.
cd /Users/maxwellrayman/dev/cliffhanger-mobile

# Prune headless session logs from prior runs. Every `claude -p` call the audit
# and repair scripts make writes a ~6-line session file, and a full pass makes
# thousands — they pile up in the session history otherwise. Run at the START so
# it still cleans up even after a run was killed mid-window. A real interactive
# session is always 20+ lines, so a line-count cut can NEVER delete one.
SESS="$HOME/.claude/projects/-Users-maxwellrayman-dev-cliffhanger-mobile"
if [ -d "$SESS" ]; then
  pruned=0
  for f in "$SESS"/*.jsonl; do
    [ -f "$f" ] || continue
    n=$(wc -l < "$f" 2>/dev/null)
    if [ "${n:-99}" -lt 20 ]; then rm -f "$f"; pruned=$((pruned+1)); fi
  done
  echo "pruned $pruned headless session logs"
fi

echo "===== PHASE 1: re-audit — restore clobbered + audit anything un-audited ====="
node scripts/audit-spine.mjs --all

echo ""
echo "===== PHASE 2: repair every flagged show, best-first, re-audit only changed seasons ====="
node scripts/repair-pass.mjs

echo ""
echo "===== window done — re-run scripts/finish-recaps.sh to continue ====="
node -e 'const fs=require("fs"),D="src/recap/data";const man=new Set(JSON.parse(fs.readFileSync("scripts/batch-manifest.json")).shows.map(s=>s.slug));let c=0,fl=0,re=0;for(const s of man){if(!fs.existsSync(`${D}/${s}.spine.json`))continue;const p=`${D}/${s}.audit.json`;if(!fs.existsSync(p)){re++;continue}try{const a=JSON.parse(fs.readFileSync(p));if((a.results||[]).some(r=>r.error)){re++;continue}let h=0;for(const r of a.results)for(const x of r.flags||[])if(x.severity==="high")h++;h?fl++:c++}catch{re++}}console.log(`clean(shippable) ${c} | flagged ${fl} | need-reaudit ${re}`)'
