// Environment and HTTP plumbing shared by every recap stage.
//
// Hand-parsed .env rather than --env-file, which isn't available on every Node
// version this repo might run under.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Working directory for fetch artifacts, verify cache, contact sheets. */
export const WORK = resolve(ROOT, 'scripts', 'recap-work');

export async function loadEnv() {
  const raw = await readFile(resolve(ROOT, '.env'), 'utf8').catch(() => '');
  const env = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

/**
 * TMDB accepts two credential types and they are NOT interchangeable:
 *   - v4 Read Access Token: long JWT, Bearer header only
 *   - v3 API Key: ~32 hex chars, ?api_key= query param only
 * Swapping them yields an opaque 401, so validate the shape up front.
 */
export function resolveTmdbAuth(env) {
  const token = env.TMDB_READ_TOKEN?.trim();
  const key = env.TMDB_API_KEY?.trim();
  if (token && token.startsWith('eyJ')) {
    return { mode: 'bearer', headers: { Authorization: `Bearer ${token}` }, query: '' };
  }
  if (key && /^[a-f0-9]{32}$/i.test(key)) {
    return { mode: 'api_key', headers: {}, query: `api_key=${key}` };
  }
  if (key) return { mode: 'api_key(unverified)', headers: {}, query: `api_key=${key}` };
  throw new Error('No TMDB credentials. Set TMDB_READ_TOKEN (preferred) or TMDB_API_KEY in .env');
}

// Wikipedia's API policy requires a descriptive User-Agent identifying the
// client and a contact address. Requests without one get rate-limited into
// 429s, which read downstream as "0% plot coverage" — see fetch.mjs.
export const WIKI_UA =
  'CliffhangerRecapBot/1.0 (https://cliffhangerapp.com; cliffhanger.support@gmail.com)';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function getJSON(url, init, label, attempt = 0) {
  const res = await fetch(url, init);
  // Grounding quality depends entirely on these lookups landing, so a 429 must
  // not be allowed to degrade quietly into a worse recap.
  if (res.status === 429 && attempt < 4) {
    const wait = Number(res.headers.get('retry-after')) * 1000 || 1500 * 2 ** attempt;
    console.log(`    · ${label} rate-limited, retrying in ${Math.round(wait / 1000)}s`);
    await sleep(wait);
    return getJSON(url, init, label, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${label} failed ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

export function makeTmdb(auth) {
  return (path, params = '') => {
    const qs = [auth.query, params].filter(Boolean).join('&');
    const url = `https://api.themoviedb.org/3${path}${qs ? `?${qs}` : ''}`;
    return getJSON(url, { headers: auth.headers }, `TMDB ${path}`);
  };
}
