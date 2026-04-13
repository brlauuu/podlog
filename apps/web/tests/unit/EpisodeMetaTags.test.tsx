/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import EpisodeMetaTags from "@/components/EpisodeMetaTags";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

const baseProps = {
  status: "done",
  publishedAt: "2024-03-15T10:00:00Z",
  durationSecs: 3723,
  transcribeDurationSecs: 142,
  diarizeDurationSecs: 88,
  diarizeStepDurations: null,
  inferenceProviderUsed: null,
  fireworksSttCostUsd: null,
  fireworksAudioMinutes: null,
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
});
