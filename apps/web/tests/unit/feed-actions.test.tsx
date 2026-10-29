/**
 * FeedActions renders an action only when its callback is supplied (#1090):
 * the podcast page leaves Delete out. The mode rules themselves are covered
 * through FeedCard in feed-card.test.tsx.
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import FeedActions from "@/components/FeedActions";

const FEED = { id: "f-1", mode: "test", paused: false };

describe("FeedActions", () => {
  it("renders nothing when no callbacks are supplied", () => {
    const { container } = render(<FeedActions feed={FEED} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("omits Delete without onDelete while keeping the other actions", () => {
    render(
      <FeedActions feed={FEED} onPromote={() => {}} onPoll={() => {}} onTogglePause={() => {}} />,
    );

    expect(screen.getByRole("button", { name: /promote to full/i })).toBeInTheDocument();
    expect(screen.getByTitle("Poll now")).toBeInTheDocument();
    expect(screen.getByTitle("Pause ingestion")).toBeInTheDocument();
    expect(screen.queryByTitle("Remove feed")).not.toBeInTheDocument();
  });

  it("renders Delete when onDelete is supplied", () => {
    render(<FeedActions feed={FEED} onDelete={() => {}} />);
    expect(screen.getByTitle("Remove feed")).toBeInTheDocument();
  });
});
