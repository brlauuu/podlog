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
  /** #1133: a confirmed name kept across a re-process that renumbered the
   *  speakers; it may now be on a different voice. Absent means false. */
  needs_review?: boolean;
  text: string;
}

/** #1133: a name the user confirmed whose speaker label no segment uses
 *  any more, after a re-process rebuilt the speakers. */
export interface UnmatchedSpeakerName {
  speaker_label: string;
  display_name: string;
}

export type SpeakerRole = "host" | "guest" | "other";
