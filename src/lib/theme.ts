// Ported from web app — hex alpha converted to rgba() for React Native compatibility

export const theme = {
  bg: '#131520',
  bgCard: '#181a2a',
  bgDarker: '#10111e',
  border: 'rgba(255,255,255,0.05)',
  text: '#e8e6e3',
  textDim: 'rgba(255,255,255,0.31)',
  textFaint: 'rgba(255,255,255,0.19)',
  accent: '#ff6b35',
} as const;

export const SEASON_COLORS = [
  '#6ee7b7', '#fbbf24', '#f87171', '#60a5fa', '#c084fc',
  '#fb923c', '#34d399', '#f472b6', '#38bdf8', '#a3e635',
  '#e879f9', '#facc15',
];

export const SEASON_SHAPES = [
  'circle', 'diamond', 'square', 'triangle', 'triangleDown',
  'circle', 'diamond', 'square', 'triangle', 'triangleDown',
];
