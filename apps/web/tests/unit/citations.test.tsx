/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

import { preprocessCitations, MarkdownAnswer, type Source } from "@/lib/citations";

const sources: Source[] = [
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
];

describe("preprocessCitations", () => {
  test("converts a matched citation to a podlog-cite:// Markdown link", () => {
    const result = preprocessCitations("See [Episode 42, 2:05] for details.", sources);
    expect(result).toBe("See [Episode 42, 2:05](podlog-cite://ep-42/125) for details.");
  });

  test("bolds unmatched citations without adding a link", () => {
    const result = preprocessCitations("See [Unknown Show, 1:00] here.", sources);
    expect(result).toBe("See **[Unknown Show, 1:00]** here.");
  });

  test("leaves text without citations unchanged", () => {
    const input = "No citations here.";
    expect(preprocessCitations(input, [])).toBe(input);
  });
});

describe("MarkdownAnswer", () => {
  test("renders a citation as a link to the episode timestamp (urlTransform passes podlog-cite:// through)", () => {
    render(
      <MarkdownAnswer
        text="See [Episode 42, 2:05] for details."
        sources={sources}
      />
    );
    expect(screen.getByRole("link", { name: "Episode 42, 2:05" })).toHaveAttribute(
      "href",
      "/episodes/ep-42#t-125"
    );
  });

  test("renders citation as a button and fires onCitationClick when provided", async () => {
    const user = userEvent.setup();
    const onCitationClick = jest.fn();
    render(
      <MarkdownAnswer
        text="See [Episode 42, 2:05] for details."
        sources={sources}
        onCitationClick={onCitationClick}
      />
    );
    const btn = screen.getByRole("button", { name: "Episode 42, 2:05" });
    await user.click(btn);
    expect(onCitationClick).toHaveBeenCalledWith("ep-42", 125);
  });

  test("renders external URLs as target=_blank links", () => {
    render(
      <MarkdownAnswer
        text="Read more at [example](https://example.com)."
        sources={[]}
      />
    );
    const link = screen.getByRole("link", { name: "example" });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
  });
});
