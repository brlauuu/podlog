/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
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
});
