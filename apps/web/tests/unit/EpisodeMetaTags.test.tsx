/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import EpisodeMetaTags from "@/components/EpisodeMetaTags";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

const baseProps = {
  status: "done",
  publishedAt: "2024-03-15T10:00:00Z",
  durationSecs: 3723,
  language: null,
  hasDiarization: true,
  transcribeDurationSecs: 142,
  diarizeDurationSecs: 88,
  diarizeStepDurations: null,
  inferenceProviderUsed: null,
  episodeId: "ep-123",
};

describe("EpisodeMetaTags", () => {
  it("renders published date tag", () => {
    render(<EpisodeMetaTags {...baseProps} />);
    expect(screen.getByText(/2024/)).toBeInTheDocument();
  });

  it("renders duration tag", () => {
    render(<EpisodeMetaTags {...baseProps} />);
    expect(screen.getByText("1:02:03")).toBeInTheDocument();
  });

  it("renders transcription duration tag", () => {
    render(<EpisodeMetaTags {...baseProps} />);
    expect(screen.getByText(/Transcribed:/)).toBeInTheDocument();
    expect(screen.getByText(/2:22/)).toBeInTheDocument();
  });

  it("renders diarization duration tag", () => {
    render(<EpisodeMetaTags {...baseProps} />);
    expect(screen.getByRole("button", { name: /Diarized:/ })).toBeInTheDocument();
    expect(screen.getByText(/1:28/)).toBeInTheDocument();
  });

  it("does not render status tag when status is done", () => {
    render(<EpisodeMetaTags {...baseProps} />);
    expect(screen.queryByText(/Transcribing|Downloading|Diarizing|Failed/)).not.toBeInTheDocument();
  });

  it("renders status tag for in-progress status", () => {
    render(<EpisodeMetaTags {...baseProps} status="transcribing" />);
    expect(screen.getByText("Transcribing")).toBeInTheDocument();
  });

  it("renders status tag for failed status", () => {
    render(<EpisodeMetaTags {...baseProps} status="failed" />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("omits date tag when publishedAt is null", () => {
    render(<EpisodeMetaTags {...baseProps} publishedAt={null} />);
    expect(screen.getByText("1:02:03")).toBeInTheDocument();
  });

  it("omits transcription tag when transcribeDurationSecs is null", () => {
    render(<EpisodeMetaTags {...baseProps} transcribeDurationSecs={null} />);
    expect(screen.queryByText(/Transcribed:/)).not.toBeInTheDocument();
  });

  it("omits diarization tag when diarizeDurationSecs is null", () => {
    render(<EpisodeMetaTags {...baseProps} diarizeDurationSecs={null} />);
    expect(screen.queryByRole("button", { name: /Diarized:/ })).not.toBeInTheDocument();
  });

  it("does not render Fireworks tag when inferenceProviderUsed is not fireworks", () => {
    render(<EpisodeMetaTags {...baseProps} inferenceProviderUsed="local" />);
    expect(screen.queryByText(/Fireworks STT/)).not.toBeInTheDocument();
  });

  it("uses consistent chip sizing classes for standard, diarized, and provenance tags", () => {
    render(<EpisodeMetaTags {...baseProps} inferenceProviderUsed="fireworks" />);

    const dateTag = screen.getByText(/2024/);
    const diarizedTag = screen.getByRole("button", { name: /Diarized:/ });
    const remoteTag = screen.getByText("Transcribed remotely");

    expect(dateTag).toHaveClass("inline-flex", "h-5", "items-center", "leading-none");
    expect(diarizedTag).toHaveClass("inline-flex", "h-5", "items-center", "leading-none");
    expect(remoteTag).toHaveClass("inline-flex", "h-5", "items-center", "leading-none");
  });

  it("shows diarization step tags when Diarized tag is clicked", async () => {
    const user = userEvent.setup();
    render(
      <EpisodeMetaTags
        {...baseProps}
        diarizeStepDurations={{ load_model_secs: 5, run_pipeline_secs: 83 }}
      />
    );
    expect(screen.queryByText(/Load model:/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Diarized:/ }));
    expect(screen.getByText(/Load model:/)).toBeInTheDocument();
    expect(screen.getByText(/Run pipeline:/)).toBeInTheDocument();
  });

  it("hides diarization step tags when Diarized tag is clicked again", async () => {
    const user = userEvent.setup();
    render(
      <EpisodeMetaTags
        {...baseProps}
        diarizeStepDurations={{ load_model_secs: 5, run_pipeline_secs: 83 }}
      />
    );
    const btn = screen.getByRole("button", { name: /Diarized:/ });
    await user.click(btn);
    await user.click(btn);
    expect(screen.queryByText(/Load model:/)).not.toBeInTheDocument();
  });

  it("renders ReprocessButton", () => {
    render(<EpisodeMetaTags {...baseProps} />);
    expect(screen.getByRole("button", { name: /Reprocess/i })).toBeInTheDocument();
  });

  // Issue #609: parity with the episode card's tag strip.
  it("renders language tag with flag when language is set", () => {
    render(<EpisodeMetaTags {...baseProps} language="en" />);
    expect(screen.getByText(/EN/)).toBeInTheDocument();
    // Flag emoji 🇺🇸 — assert the tag contains it.
    expect(screen.getByText(/🇺🇸/)).toBeInTheDocument();
  });

  it("renders language code without flag when unmapped", () => {
    render(<EpisodeMetaTags {...baseProps} language="xx" />);
    expect(screen.getByText("XX")).toBeInTheDocument();
  });

  it("omits language tag when language is null", () => {
    render(<EpisodeMetaTags {...baseProps} language={null} />);
    // No "EN" or any 2-letter all-caps tag from the language slot.
    expect(screen.queryByText(/^EN$/)).toBeNull();
  });

  // #1092: everything runs locally, so only the older remote episodes carry
  // a provenance tag, and no episode shows a cost.
  it.each([null, "local"])("renders no provider tag for provider %p", (provider) => {
    render(<EpisodeMetaTags {...baseProps} inferenceProviderUsed={provider} />);
    expect(screen.queryByText(/inference|remotely/i)).toBeNull();
  });

  it("marks an episode transcribed remotely before #1092", () => {
    render(<EpisodeMetaTags {...baseProps} inferenceProviderUsed="fireworks" />);
    expect(screen.getByText("Transcribed remotely")).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it("renders 'No labels' tag when done but no diarization", () => {
    render(<EpisodeMetaTags {...baseProps} hasDiarization={false} />);
    expect(screen.getByText(/No labels/)).toBeInTheDocument();
  });

  it("does not render 'No labels' tag when status is not done", () => {
    render(
      <EpisodeMetaTags
        {...baseProps}
        status="failed"
        hasDiarization={false}
      />,
    );
    expect(screen.queryByText(/No labels/)).toBeNull();
  });
  // #1093: the word-time source is shown, so a language that lost its
  // word times is visible on the page instead of only in a log.
  it("labels wav2vec2-aligned word timing", () => {
    render(<EpisodeMetaTags {...baseProps} wordTimestamps="wav2vec2" />);
    expect(screen.getByText("Word timing: aligned")).toBeInTheDocument();
  });

  it("labels native Whisper word timing with an explanation", () => {
    render(<EpisodeMetaTags {...baseProps} wordTimestamps="native" />);
    const tag = screen.getByText("Word timing: Whisper");
    expect(tag).toHaveAttribute("title", expect.stringMatching(/No alignment model/));
  });

  it("warns when no word timing was available", () => {
    render(<EpisodeMetaTags {...baseProps} wordTimestamps="none" />);
    expect(screen.getByText("No word timing")).toBeInTheDocument();
  });

  it("claims nothing for episodes transcribed before the source was recorded", () => {
    render(<EpisodeMetaTags {...baseProps} wordTimestamps={null} />);
    expect(screen.queryByText(/word timing/i)).not.toBeInTheDocument();
  });
});
