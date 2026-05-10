/** Canonical transcript segment — source of truth for all components. */
export interface Segment {
  id: number;
  start_time: number;
  end_time: number;
  speaker_label: string | null;
  display_name: string | null;
  inferred: boolean;
  confirmed_by_user: boolean;
  /** User-assigned role for this speaker on this episode (#698). */
  role: SpeakerRole | null;
  text: string;
}

export type SpeakerRole = "host" | "guest" | "other";
