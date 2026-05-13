"use client";

/**
 * Step 1 of the Add Feed dialog: URL input + mode picker
 * (test / selective / full). Split out of page.tsx in #664.
 */
import { FlaskConical, ListChecks } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type AddMode = "test" | "full" | "selective";

interface Props {
  url: string;
  onUrlChange: (value: string) => void;
  mode: AddMode;
  onModeChange: (mode: AddMode) => void;
  error: string | null;
  submitting: boolean;
  previewLoading: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}

export default function AddFeedStep1({
  url,
  onUrlChange,
  mode,
  onModeChange,
  error,
  submitting,
  previewLoading,
  onSubmit,
  onCancel,
}: Props) {
  const modeButton = (
    value: AddMode,
    label: React.ReactNode,
  ) => (
    <button
      type="button"
      onClick={() => onModeChange(value)}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
        mode === value
          ? "bg-action text-action-foreground"
          : "bg-muted text-muted-foreground hover:bg-accent"
      }`}
    >
      {label}
    </button>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Input
        type="url"
        value={url}
        onChange={(e) => onUrlChange(e.target.value)}
        placeholder="https://feeds.example.com/podcast.xml"
        required
        autoFocus
      />
      <div className="flex items-center gap-2">
        {modeButton(
          "test",
          <>
            <FlaskConical size={14} />
            Test (1 episode)
          </>,
        )}
        {modeButton(
          "selective",
          <>
            <ListChecks size={14} />
            Select episodes
          </>,
        )}
        {modeButton("full", <>Full</>)}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting || previewLoading}>
          {previewLoading
            ? "Loading..."
            : mode === "selective"
            ? "Next"
            : submitting
            ? "Adding..."
            : "Add"}
        </Button>
      </div>
    </form>
  );
}
