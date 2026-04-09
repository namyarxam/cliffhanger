import type { ShowSummary, ShowFull, Season, Episode } from './types';

const TVMAZE_BASE = 'https://api.tvmaze.com';

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

function extractYear(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const y = parseInt(dateStr.slice(0, 4), 10);
  return isNaN(y) ? null : y;
}

// ─── TVMaze response types (internal) ───────────────────────────────────────

interface TVMazeShow {
  id: number;
  name: string;
  premiered: string | null;
  ended: string | null;
  genres: string[];
  status: string;
  network: { name: string } | null;
  webChannel: { name: string } | null;
  image: { medium: string; original: string } | null;
  summary: string | null;
  rating: { average: number | null };
}

interface TVMazeSearchResult {
  score: number;
  show: TVMazeShow;
}

interface TVMazeEpisode {
  id: number;
  name: string;
  season: number;
  number: number | null;
  airdate: string;
  airtime: string;
  runtime: number | null;
  rating: { average: number | null };
}

// ─── Transform TVMaze data to our types ─────────────────────────────────────

function toShowSummary(show: TVMazeShow): ShowSummary {
  return {
    id: String(show.id),
    title: show.name,
    year: extractYear(show.premiered),
    endYear: extractYear(show.ended),
    genre: show.genres[0] || '',
    genres: show.genres,
    image: show.image?.medium ?? null,
    network: show.network?.name ?? show.webChannel?.name ?? null,
    status: show.status,
    summary: show.summary ? stripHtml(show.summary) : null,
  };
}

function groupEpisodes(episodes: TVMazeEpisode[]): Season[] {
  const seasonMap = new Map<number, Episode[]>();

  for (const ep of episodes) {
    if (ep.number == null) continue;
    const s = ep.season;
    if (!seasonMap.has(s)) seasonMap.set(s, []);
    seasonMap.get(s)!.push({
      number: ep.number,
      title: ep.name,
      rating: ep.rating?.average ?? null,
      airdate: ep.airdate || null,
      airtime: ep.airtime || null,
      runtime: ep.runtime ?? null,
    });
  }

  return Array.from(seasonMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([num, eps]) => ({
      number: num,
      episodes: eps.sort((a, b) => a.number - b.number),
    }));
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function searchShows(query: string): Promise<ShowSummary[]> {
  if (!query.trim()) return [];
  const res = await fetch(`${TVMAZE_BASE}/search/shows?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  const results: TVMazeSearchResult[] = await res.json();
  return results.map(r => toShowSummary(r.show));
}

export async function fetchShow(id: string): Promise<ShowFull> {
  const res = await fetch(`${TVMAZE_BASE}/shows/${id}?embed[]=episodes`);
  if (!res.ok) throw new Error(`Failed to fetch show ${id}: ${res.status}`);
  const data = await res.json();

  const show: TVMazeShow = data;
  const episodes: TVMazeEpisode[] = data._embedded?.episodes ?? [];
  const seasons = groupEpisodes(episodes);

  return {
    ...toShowSummary(show),
    seasons,
    totalSeasons: seasons.length,
    totalEpisodes: episodes.filter(e => e.number != null).length,
    rating: show.rating?.average ?? null,
  };
}
