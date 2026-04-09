/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

jest.mock("next/link", () => {
  function MockLink({ href, children, ...props }: { href: string; children: React.ReactNode }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  }
  MockLink.displayName = "MockLink";
  return MockLink;
});

import { renderAnswerWithCitations } from "@/lib/citations";

describe("renderAnswerWithCitations", () => {
  test("links Ask citations to the episode timestamp hash", () => {
    render(
      <div>{renderAnswerWithCitations("See [Episode 42, 2:05] for details.", [
        {
          chunk_id: 1,
          episode_id: "ep-42",
          episode_title: "Episode 42",
          audio_local_path: null,
          speaker_label: null,
          start_time: 125,
          end_time: 140,
          timestamp: "2:05",
          text: "excerpt",
          similarity: 0.8,
        },
      ])}</div>
    );

    expect(screen.getByRole("link", { name: "[Episode 42, 2:05]" })).toHaveAttribute(
      "href",
      "/episodes/ep-42#t-125"
    );
  });
});
