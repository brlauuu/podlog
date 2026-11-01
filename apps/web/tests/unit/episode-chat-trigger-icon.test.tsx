/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

jest.mock("@/components/AudioPlayerContext", () => ({
  useAudioPlayer: () => ({ state: { src: null } }),
}));

// Stub fetch so the model-hydration useEffect doesn't blow up (#637).
global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;

import EpisodeChat from "@/components/EpisodeChat";

describe("EpisodeChat trigger icon", () => {
  test("uses BrainCircuit icon for ask trigger", () => {
    const { container } = render(
      <EpisodeChat episodeId="ep-1" episodeTitle="Example Episode" />
    );

    expect(
      screen.getByRole("button", { name: /ask about this episode/i })
    ).toBeInTheDocument();
    expect(container.querySelector(".lucide-brain-circuit")).toBeInTheDocument();
    expect(container.querySelector(".lucide-message-square")).not.toBeInTheDocument();
  });

  test("is icon-only on a phone and reserves space below the page (#1131)", () => {
    render(<EpisodeChat episodeId="ep-1" episodeTitle="Example Episode" />);

    const button = screen.getByRole("button", { name: /ask about this episode/i });
    // The label stays for screen readers and returns from the sm breakpoint.
    expect(screen.getByText("Ask")).toHaveClass("sr-only", "sm:not-sr-only");
    expect(button).toHaveClass("right-4", "bottom-4", "sm:right-6", "sm:bottom-6");
    expect(screen.getByTestId("ask-spacer")).toHaveAttribute("aria-hidden", "true");
  });
});
