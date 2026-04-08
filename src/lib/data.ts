import type { ShowSummary, ShowFull } from './types';

// For now, load rankings from bundled asset.
// Individual show files will be fetched from CDN once we set one up.
// During development, we can point to the web app's public/data/ served locally.
const DATA_BASE = 'http://localhost:3000/data';

export async function fetchRankings(): Promise<ShowSummary[]> {
  const res = await fetch(`${DATA_BASE}/rankings.json`);
  if (!res.ok) throw new Error(`Failed to fetch rankings: ${res.status}`);
  return res.json();
}

export async function fetchShow(id: string): Promise<ShowFull> {
  const res = await fetch(`${DATA_BASE}/shows/${id}.json`);
  if (!res.ok) throw new Error(`Failed to fetch show ${id}: ${res.status}`);
  return res.json();
}
