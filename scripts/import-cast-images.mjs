#!/usr/bin/env node
/**
 * Turn a folder of hand-saved character pictures into hosted portrait URLs.
 *
 * WHY NOT JUST PASTE THE SOURCE URL INTO _cast-images.json
 *
 * upload-recap freezes the exact image URL into the database, so every user
 * loads whatever that URL serves for as long as the row lives. A wiki URL is
 * the wrong thing to freeze: those hosts rotate paths, and several refuse
 * requests without their own referer, so the card would go blank for real users
 * while still looking fine in review. Copying the bytes into our own bucket
 * makes the picture as stable as every other frame in the recap.
 *
 * So the manual job is only ever: find a picture, save it with the right
 * filename. This uploads it and writes the URL back.
 *
 * Usage:
 *   node scripts/import-cast-images.mjs --urls                 # read cast-image-urls.txt
 *   node scripts/import-cast-images.mjs --list                 # what to save, and as what
 *   node scripts/import-cast-images.mjs --dir ~/Desktop/pics   # upload + record
 *   node scripts/import-cast-images.mjs --dir ~/Desktop/pics --dry-run
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, resolve, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'src/recap/data');
const OVERRIDES = resolve(DATA, '_cast-images.json');
const BUCKET = 'recap-portraits';
const URL_LIST = resolve(DATA, 'cast-image-urls.txt');

/**
 * Pasted URLs, one per line: `slug | Character Name = https://...`
 *
 * Read once and then discarded in favour of our own copy. The pasted link only
 * has to work at this moment — see the header for why we never freeze it.
 */
function pastedUrls() {
  let text;
  try { text = readFileSync(URL_LIST, 'utf8'); } catch { return []; }
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const left = line.slice(0, eq).trim();
    const url = line.slice(eq + 1).trim();
    if (!url) continue;
    const bar = left.indexOf('|');
    if (bar === -1) continue;
    out.push({ slug: left.slice(0, bar).trim(), name: left.slice(bar + 1).trim(), url });
  }
  return out;
}

async function fetchImage(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    // Some wiki CDNs refuse a bare programmatic request.
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/*,*/*' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  if (!type.startsWith('image/')) throw new Error(`not an image (${type || 'unknown type'})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) throw new Error(`suspiciously small (${buf.length} bytes)`);
  return { buf, type };
}

const arg = (f, d = null) => {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : d;
};

/** Filename-safe form of a character name. "Atom Eve / Samantha Wilkins" -> "atom-eve-samantha-wilkins" */
const slugify = s =>
  String(s).toLowerCase().replace(/['']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function loadEnv() {
  try {
    const raw = await readFile(resolve(ROOT, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* ambient env */ }
}

function wanted() {
  const raw = JSON.parse(readFileSync(OVERRIDES, 'utf8'));
  delete raw._readme;
  const rows = [];
  for (const [slug, chars] of Object.entries(raw))
    for (const [name, url] of Object.entries(chars))
      rows.push({ slug, name, url, file: `${slug}__${slugify(name)}` });
  return rows;
}

async function main() {
  const rows = wanted();
  const dir = arg('--dir');
  const dryRun = process.argv.includes('--dry-run');
  const fromUrls = process.argv.includes('--urls');

  if (!fromUrls && (process.argv.includes('--list') || !dir)) {
    const todo = rows.filter(r => !r.url);
    console.log(`\nSave one picture per line below, into a single folder.`);
    console.log(`Any of .jpg .jpeg .png .webp — the extension does not matter, the NAME does.\n`);
    let show = null;
    for (const r of todo) {
      if (r.slug !== show) { console.log(`  ${r.slug}`); show = r.slug; }
      console.log(`      ${r.file}.jpg        ← ${r.name}`);
    }
    console.log(`\n  ${todo.length} to find. ${rows.length - todo.length} already have a URL.`);
    console.log(`\nThen: node scripts/import-cast-images.mjs --dir <that folder>\n`);
    return;
  }

  await loadEnv();
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('\n✗ need EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env\n');
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  // Public bucket: these are recap frames, served to every reader of the recap.
  if (!dryRun) {
    const { data: buckets } = await db.storage.listBuckets();
    if (!buckets?.some(b => b.name === BUCKET)) {
      const { error } = await db.storage.createBucket(BUCKET, { public: true });
      if (error && !/exists/i.test(error.message)) {
        console.error(`✗ could not create bucket: ${error.message}`);
        process.exit(1);
      }
      console.log(`  created public bucket "${BUCKET}"`);
    }
  }

  if (fromUrls) {
    const pasted = pastedUrls();
    if (!pasted.length) {
      console.log(`\n  nothing to do — no URLs filled in yet in ${URL_LIST}\n`);
      return;
    }
    const overrides = JSON.parse(await readFile(OVERRIDES, 'utf8'));
    const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
    let ok = 0;
    const failed = [];
    for (const p of pasted) {
      if (!overrides[p.slug] || !(p.name in overrides[p.slug])) {
        failed.push(`${p.slug} / ${p.name} — not a character awaiting a picture (check spelling)`);
        continue;
      }
      if (overrides[p.slug][p.name]) { continue; }  // already hosted or dropped
      // "drop" is a decision, not a link — record it and move on.
      if (/^drop$/i.test(p.url)) {
        if (!dryRun) overrides[p.slug][p.name] = 'drop';
        console.log(`  – ${p.slug} / ${p.name}  (dropped, no card)`);
        ok++;
        continue;
      }
      let img;
      try { img = await fetchImage(p.url); }
      catch (e) { failed.push(`${p.slug} / ${p.name} — ${e.message}`); continue; }
      const key2 = `${p.slug}/${slugify(p.name)}${EXT[img.type] ?? '.jpg'}`;
      if (dryRun) { console.log(`  would host ${p.name} (${(img.buf.length / 1024).toFixed(0)}kb) -> ${key2}`); ok++; continue; }
      const { error } = await db.storage
        .from(BUCKET)
        .upload(key2, img.buf, { contentType: img.type, upsert: true });
      if (error) { failed.push(`${p.slug} / ${p.name} — upload: ${error.message}`); continue; }
      const { data } = db.storage.from(BUCKET).getPublicUrl(key2);
      overrides[p.slug][p.name] = data.publicUrl;
      console.log(`  ✓ ${p.slug} / ${p.name}  (${(img.buf.length / 1024).toFixed(0)}kb)`);
      ok++;
    }
    if (!dryRun) await writeFile(OVERRIDES, JSON.stringify(overrides, null, 2) + '\n');
    const remaining = wanted().filter(r => !overrides[r.slug]?.[r.name]).length;
    console.log(`\n  ${ok} hosted, ${failed.length} failed, ${remaining} still blank.`);
    for (const f of failed) console.log(`      ✗ ${f}`);
    if (ok && !dryRun) {
      const shows = [...new Set(pasted.map(p => p.slug))].filter(s => overrides[s]);
      console.log(`\n  now re-upload those shows:`);
      for (const s of shows) console.log(`      node scripts/upload-recap.mjs --slug ${s}`);
      console.log('');
    }
    return;
  }

  const files = await readdir(resolve(dir));
  const byStem = new Map();
  for (const f of files) {
    if (f.startsWith('.')) continue;
    byStem.set(basename(f, extname(f)).toLowerCase(), f);
  }

  const overrides = JSON.parse(await readFile(OVERRIDES, 'utf8'));
  let done = 0, missing = [];
  const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

  for (const r of rows) {
    if (r.url) continue;
    const hit = byStem.get(r.file.toLowerCase());
    if (!hit) { missing.push(r); continue; }
    const ext = extname(hit).toLowerCase();
    const key2 = `${r.slug}/${slugify(r.name)}${ext}`;
    if (dryRun) {
      console.log(`  would upload ${hit}  ->  ${key2}`);
      done++;
      continue;
    }
    const body = await readFile(resolve(dir, hit));
    const { error } = await db.storage
      .from(BUCKET)
      .upload(key2, body, { contentType: MIME[ext] ?? 'image/jpeg', upsert: true });
    if (error) { console.error(`  ✗ ${r.name}: ${error.message}`); continue; }
    const { data } = db.storage.from(BUCKET).getPublicUrl(key2);
    overrides[r.slug][r.name] = data.publicUrl;
    console.log(`  ✓ ${r.slug} / ${r.name}`);
    done++;
  }

  if (!dryRun) await writeFile(OVERRIDES, JSON.stringify(overrides, null, 2) + '\n');
  console.log(`\n  ${done} uploaded, ${missing.length} still missing.`);
  if (missing.length) {
    console.log(`  no file found for:`);
    for (const m of missing.slice(0, 12)) console.log(`      ${m.file}.jpg   (${m.slug} / ${m.name})`);
  }
  if (done && !dryRun) {
    const shows = [...new Set(rows.filter(r => !r.url && byStem.has(r.file.toLowerCase())).map(r => r.slug))];
    console.log(`\n  then re-upload those shows:`);
    console.log(`      ${shows.map(s => `node scripts/upload-recap.mjs --slug ${s}`).join('\n      ')}\n`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
