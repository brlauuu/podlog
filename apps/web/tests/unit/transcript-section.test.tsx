/**
 * Tests for TranscriptSection — state coordination between SpeakerPanel,
 * TranscriptView, and the export button.
 *
 * Child components are mocked to keep this focused on TranscriptSection's
 * own logic (handleRenamed / handleMerged segment updates).
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

jest.mock("@/components/TranscriptView", () => ({
  __esModule: true,
  default: ({ segments }: { segments: Array<{ id: number; text: string; display_name?: string | null; speaker_label: string | null }> }) => (
    <div data-testid="transcript-view">
      {segments.map((s) => (
        <div key={s.id} data-testid={`seg-${s.id}`}>
          {s.speaker_label ?? "—"}:{s.display_name ?? ""}:{s.text}
        </div>
      ))}
    </div>
  ),
}));

jest.mock("@/components/TranscriptExportButton", () => ({
  __esModule: true,
  default: () => <button>Export transcript</button>,
}));

type SpeakerPanelProps = {
  onRenamed: (speakerLabel: string, newName: string) => void;
  onMerged: (sourceLabels: string[], targetLabel: string) => void;
};
let capturedSpeakerPanelProps: SpeakerPanelProps | null = null;

jest.mock("@/components/SpeakerPanel", () => ({
  __esModule: true,
  default: (props: SpeakerPanelProps) => {
    capturedSpeakerPanelProps = props;
    return <div data-testid="speaker-panel" />;
  },
}));

import TranscriptSection from "@/components/TranscriptSection";
import { AudioPlayerProvider } from "@/components/AudioPlayerContext";

function wrap(ui: React.ReactNode) {
  return <AudioPlayerProvider>{ui}</AudioPlayerProvider>;
}

const baseProps = {
  episodeId: "ep-1",
  hasDiarization: true,
  status: "done",
  audioLocalPath: null,
  episodeTitle: null,
  feedTitle: null,
  publishedAt: null,
  durationSecs: null,
  description: null,
  feedUrl: null,
  feedWebsiteUrl: null,
  feedDescription: null,
  audioUrl: null,
  guid: null,
};

const sampleSegments = [
  {
    id: 1,
    start_time: 0,
    end_time: 5,
    speaker_label: "SPEAKER_00",
    display_name: null,
    inferred: false,
    confirmed_by_user: false,
    text: "hello",
  },
  {
    id: 2,
    start_time: 5,
    end_time: 10,
    speaker_label: "SPEAKER_01",
    display_name: null,
    inferred: false,
    confirmed_by_user: false,
    text: "world",
  },
];

describe("TranscriptSection", () => {
  beforeEach(() => {
    capturedSpeakerPanelProps = null;
  });

  it("renders SpeakerPanel when hasDiarization=true", () => {
    render(wrap(<TranscriptSection {...baseProps} segments={sampleSegments} />));
    expect(screen.getByTestId("speaker-panel")).toBeInTheDocument();
    expect(screen.getByTestId("transcript-view")).toBeInTheDocument();
  });

  it("hides SpeakerPanel when hasDiarization=false", () => {
    render(
      wrap(
        <TranscriptSection
          {...baseProps}
          hasDiarization={false}
          segments={sampleSegments}
        />
      )
    );
    expect(screen.queryByTestId("speaker-panel")).not.toBeInTheDocument();
  });

  it("omits the export button when there are no segments", () => {
    render(wrap(<TranscriptSection {...baseProps} segments={[]} />));
    expect(screen.queryByText("Export transcript")).not.toBeInTheDocument();
  });

  it("shows the export button when segments exist", () => {
    render(wrap(<TranscriptSection {...baseProps} segments={sampleSegments} />));
    expect(screen.getByText("Export transcript")).toBeInTheDocument();
  });

  it("handleRenamed updates display_name for matching speaker_label", () => {
    render(wrap(<TranscriptSection {...baseProps} segments={sampleSegments} />));

    act(() => {
      capturedSpeakerPanelProps!.onRenamed("SPEAKER_00", "Alice");
    });

    expect(screen.getByTestId("seg-1").textContent).toContain("Alice");
    // Other speaker untouched.
    expect(screen.getByTestId("seg-2").textContent).not.toContain("Alice");
  });

  it("handleMerged reassigns source speakers onto the target label", () => {
    const segments = [
      ...sampleSegments,
      {
        id: 3,
        start_time: 10,
        end_time: 15,
        speaker_label: "SPEAKER_00",
        display_name: "Host",
        inferred: false,
        confirmed_by_user: true,
        text: "again",
      },
    ];
    render(wrap(<TranscriptSection {...baseProps} segments={segments} />));

    act(() => {
      // Merge SPEAKER_01 into SPEAKER_00.
      capturedSpeakerPanelProps!.onMerged(["SPEAKER_01"], "SPEAKER_00");
    });

    // Segment 2 now carries SPEAKER_00 with Host display name inherited from segment 3.
    const seg2 = screen.getByTestId("seg-2").textContent;
    expect(seg2).toContain("SPEAKER_00");
    expect(seg2).toContain("Host");
  });

  it("shows the back-to-top button once window.scrollY exceeds 400", async () => {
    render(wrap(<TranscriptSection {...baseProps} segments={sampleSegments} />));
    expect(screen.queryByTitle(/back to top/i)).not.toBeInTheDocument();

    act(() => {
      Object.defineProperty(window, "scrollY", { value: 500, configurable: true });
      window.dispatchEvent(new Event("scroll"));
    });

    expect(screen.getByTitle(/back to top/i)).toBeInTheDocument();

    // Click scroll-to-top button to exercise its handler.
    const scrollSpy = jest.spyOn(window, "scrollTo").mockImplementation(() => {});
    const user = userEvent.setup();
    await user.click(screen.getByTitle(/back to top/i));
    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    scrollSpy.mockRestore();
  });
});
