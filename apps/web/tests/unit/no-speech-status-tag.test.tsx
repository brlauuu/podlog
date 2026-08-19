import { render, screen } from "@testing-library/react";

// EpisodeMetaTags renders ReprocessButton, which calls useRouter.
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));
import EpisodeMetaTags from "@/components/EpisodeMetaTags";
import { ERROR_LABELS, NON_RETRYABLE } from "@/lib/queueStatus";

describe("no_speech presentation (#955)", () => {
  it("renders as a terminal state, not as work in progress", () => {
    render(
      <EpisodeMetaTags
        status="no_speech"
        publishedAt={null}
        durationSecs={5}
        language={null}
        hasDiarization={false}
      />
    );

    // Label is humanised, not the raw enum.
    expect(screen.getByText(/no speech/i)).toBeInTheDocument();
    // The bug this guards: a terminal status rendering with a spinner reads
    // as "still processing" on an episode that has already finished.
    expect(document.querySelector(".animate-spin")).toBeNull();
  });

  it("has an operator-facing label rather than a bare enum", () => {
    expect(ERROR_LABELS.NO_SPEECH).toMatch(/no speech/i);
    expect(ERROR_LABELS.NO_SPEECH).not.toMatch(/NO_SPEECH/);
  });

  it("suppresses the Retry button", () => {
    // Retrying re-downloads and re-transcribes to reach the same result.
    expect(NON_RETRYABLE.has("NO_SPEECH")).toBe(true);
  });
});
