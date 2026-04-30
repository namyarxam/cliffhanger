// Color theme. Four palettes defined below. The ACTIVE palette is held in
// React Context via ThemeProvider — components read it through useTheme().
// Switching is live: the picker in Settings calls setThemeName() and every
// consumer re-renders with the new palette. There is no static `theme`
// export anymore — that would bake values into module-level StyleSheet.create
// calls and prevent live swap.

export type Theme = {
  bg: string;
  bgCard: string;
  bgDarker: string;
  border: string;
  text: string;
  textBright: string;
  textDim: string;
  textFaint: string;
  accent: string;
  // Tinted/translucent accent for ghost buttons + soft accent fills. Pairs
  // with accent for the foreground content. Tuned per-theme for the right
  // visual weight on each palette's bg.
  accentBg: string;
  success: string;
  successDim: string;
  successBg: string;
  successBorder: string;
  // 'light' = white status bar text (for dark themes)
  // 'dark'  = dark status bar text (for light themes)
  statusBarStyle: 'light' | 'dark';
};

// "midnight navy + warm orange" — the original. Cool blue-black bg with a
// vibrant orange accent. Linear/Vercel-adjacent. The cool/warm tension between
// bg and accent is what gives it personality.
const themeNavy: Theme = {
  bg: '#131520',
  bgCard: '#181a2a',
  bgDarker: '#10111e',
  border: 'rgba(255,255,255,0.05)',
  text: '#e8e6e3',
  textBright: '#fff',
  textDim: 'rgba(255,255,255,0.31)',
  textFaint: 'rgba(255,255,255,0.19)',
  accent: '#ff6b35',
  accentBg: 'rgba(255,107,53,0.15)',
  success: '#4ade80',
  successDim: 'rgba(74,222,128,0.7)',
  successBg: 'rgba(74,222,128,0.1)',
  successBorder: 'rgba(74,222,128,0.2)',
  statusBarStyle: 'light',
};

// "smoke + cyan-teal" — true-neutral charcoal with a faint blue undertone,
// one electric chromatic pop. Architectural, cool, considered — the "critic's
// eye." Where navy is cozy and plum is romantic, smoke is sharp and reserved.
// Accent shifted to cyan band (hue ~169°) deliberately so it's discriminable
// from navy's orange and plum's magenta under deuteranopia/protanopia (~8% of
// male users) — the warm-warm-warm trio would have collapsed for them.
const themeSmoke: Theme = {
  bg: '#1B1B1F',
  bgCard: '#26262C',
  bgDarker: '#141417',
  border: 'rgba(255,255,255,0.08)',
  text: '#E8E8EC',
  textBright: '#FFFFFF',
  textDim: 'rgba(232,232,236,0.62)',
  textFaint: 'rgba(232,232,236,0.38)',
  accent: '#3DB6A4',
  accentBg: 'rgba(61,182,164,0.15)',
  success: '#34D399',
  successDim: 'rgba(52,211,153,0.75)',
  successBg: 'rgba(52,211,153,0.12)',
  successBorder: 'rgba(52,211,153,0.32)',
  statusBarStyle: 'light',
};

// "plum + magenta" — deep aubergine base, lavender-tinted ivory text, hot
// magenta accent. Moody, cinematic, theatre-velvet. Saturated stage with
// magenta as the spotlight; seafoam mint for success keeps confirmations
// tonally cinematic instead of utilitarian.
const themePlum: Theme = {
  bg: '#1A1126',
  bgCard: '#241733',
  bgDarker: '#130C1C',
  border: 'rgba(230,215,255,0.06)',
  text: '#E8E4F0',
  textBright: '#F5F1FA',
  textDim: 'rgba(232,228,240,0.62)',
  textFaint: 'rgba(232,228,240,0.38)',
  accent: '#EC4899',
  accentBg: 'rgba(236,72,153,0.15)',
  success: '#5EEAD4',
  successDim: 'rgba(94,234,212,0.72)',
  successBg: 'rgba(94,234,212,0.12)',
  successBorder: 'rgba(94,234,212,0.28)',
  statusBarStyle: 'light',
};

// "paper + ink" — warm cream page, slate text, brick-red accent. Light theme,
// editorial / magazine / Penguin Classics register. Brick red was picked over
// burnt sienna because it hits 6.9:1 vs cream AND 5.9:1 vs white — burnt
// sienna fails the white-on-accent button case at 4.2:1, the same trap navy
// and plum's accents fall into. Bear/Things 3 convention: bgCard is slightly
// LIGHTER than bg (cards lift by being lighter on a light theme), bgDarker
// is for nested surfaces. Dim/faint text use warm-tinted black ("aged ink"),
// not neutral grey — neutral grey on cream reads as dirty.
const themePaper: Theme = {
  bg: '#F6F0E2',
  bgCard: '#FCF7EA',
  bgDarker: '#EDE5D2',
  border: 'rgba(60,45,20,0.14)',
  text: '#1C2433',
  textBright: '#0F1623',
  textDim: 'rgba(40,30,15,0.62)',
  textFaint: 'rgba(40,30,15,0.42)',
  accent: '#1B4965',
  accentBg: 'rgba(27,73,101,0.15)',
  success: '#3F6B3F',
  successDim: 'rgba(63,107,63,0.72)',
  successBg: 'rgba(63,107,63,0.12)',
  successBorder: 'rgba(63,107,63,0.32)',
  statusBarStyle: 'dark',
};

export const THEMES = {
  navy: themeNavy,
  plum: themePlum,
  smoke: themeSmoke,
  paper: themePaper,
} as const;

export type ThemeName = keyof typeof THEMES;

export const DEFAULT_THEME: ThemeName = 'navy';

export const THEME_LABELS: Record<ThemeName, string> = {
  navy: 'Navy',
  smoke: 'Smoke',
  plum: 'Plum',
  paper: 'Paper',
};

export const THEME_DESCRIPTIONS: Record<ThemeName, string> = {
  navy: 'Midnight navy + warm orange',
  smoke: 'Neutral charcoal + cyan-teal',
  plum: 'Aubergine + hot magenta',
  paper: 'Warm cream + Prussian blue',
};

export const THEME_STORAGE_KEY = '@cliffhanger:theme';

// Per-season episode dot colors. Theme-independent — these are meant to be
// distinguishable from each other regardless of background. May want
// per-theme overrides eventually if any wash out (Paper especially).
export const SEASON_COLORS = [
  '#6ee7b7', '#fbbf24', '#f87171', '#60a5fa', '#c084fc',
  '#fb923c', '#34d399', '#f472b6', '#38bdf8', '#a3e635',
  '#e879f9', '#facc15',
];

export const SEASON_SHAPES = [
  'circle', 'diamond', 'square', 'triangle', 'triangleDown',
  'circle', 'diamond', 'square', 'triangle', 'triangleDown',
];
