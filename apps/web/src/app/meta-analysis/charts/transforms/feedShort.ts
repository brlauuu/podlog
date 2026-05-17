const FEED_SHORT: Record<string, string> = {
  "Lenny's Podcast: Product | Career | Growth": "Lenny's Podcast",
  "The Jacob Shapiro Podcast": "Jacob Shapiro",
  "Dwarkesh Podcast": "Dwarkesh",
  "Geopolitical Cousins": "Geopolitical Cousins",
  "Agelast podcast": "Agelast",
  "The Twenty Minute VC (20VC): Venture Capital | Startup Funding | The Pitch": "20VC",
};

export function feedShort(title: string): string {
  return FEED_SHORT[title] ?? title;
}

// Plotly qualitative palettes (mirroring plotly.colors.qualitative.{Plotly,D3,Pastel}).
export const PALETTE = [
  "#636EFA", "#EF553B", "#00CC96", "#AB63FA", "#FFA15A",
  "#19D3F3", "#FF6692", "#B6E880", "#FF97FF", "#FECB52",
];
export const HOST_PALETTE = [
  "#1F77B4", "#FF7F0E", "#2CA02C", "#D62728", "#9467BD",
  "#8C564B", "#E377C2", "#7F7F7F", "#BCBD22", "#17BECF",
];
export const GUEST_PALETTE = [
  "#FBB4AE", "#B3CDE3", "#CCEBC5", "#DECBE4", "#FED9A6",
];

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
