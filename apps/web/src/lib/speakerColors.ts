/**
 * Speaker color palette and utilities for the transcript view.
 * Colors are assigned by speaker slot index (SPEAKER_00 = blue, etc.).
 */

interface SpeakerColor {
  name: string;
  hex: string;
  bg: string;       // Tailwind-compatible bg tint (rgba)
  border: string;   // Tailwind-compatible border tint (rgba)
}

const PALETTE: SpeakerColor[] = [
  { name: "blue",    hex: "#3b82f6", bg: "rgba(59,130,246,0.1)",  border: "rgba(59,130,246,0.3)" },
  { name: "amber",   hex: "#f59e0b", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.3)" },
  { name: "emerald", hex: "#10b981", bg: "rgba(16,185,129,0.1)", border: "rgba(16,185,129,0.3)" },
  { name: "purple",  hex: "#a855f7", bg: "rgba(168,85,247,0.1)", border: "rgba(168,85,247,0.3)" },
  { name: "rose",    hex: "#f43f5e", bg: "rgba(244,63,94,0.1)",  border: "rgba(244,63,94,0.3)" },
];

const SLOT_REGEX = /SPEAKER_(\d+)/;

export function getSpeakerColor(speakerLabel: string): SpeakerColor {
  const match = speakerLabel.match(SLOT_REGEX);
  if (!match) return PALETTE[PALETTE.length - 1];
  const index = parseInt(match[1], 10);
  return PALETTE[Math.min(index, PALETTE.length - 1)];
}

export function getSpeakerSlot(speakerLabel: string): number {
  const match = speakerLabel.match(SLOT_REGEX);
  return match ? parseInt(match[1], 10) : -1;
}

export function getSpeakerInitials(displayName: string, speakerLabel: string): string {
  if (displayName === speakerLabel || displayName.startsWith("SPEAKER_")) {
    const slot = getSpeakerSlot(speakerLabel);
    return slot >= 0 ? `S${slot}` : "?";
  }
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .slice(0, 2)
    .join("");
}
