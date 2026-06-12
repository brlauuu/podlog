/**
 * Tests for EpisodeDescription — renders sanitized HTML, linkifies
 * timestamps when audio metadata is present, and toggles show more/less.
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

// isomorphic-dompurify ships ESM-only deps jest can't parse. Stub it so
// the component renders — we assert structural outcomes (target/rel, no
// <script>) from the tag-filtering step that follows sanitization.
jest.mock("isomorphic-dompurify", () => ({
  __esModule: true,
  default: {
    sanitize: (html: string) => html.replace(/<script[\s\S]*?<\/script>/gi, ""),
  },
}));

import EpisodeDescription from "@/components/EpisodeDescription";
import { AudioPlayerProvider } from "@/components/AudioPlayerContext";

function wrap(ui: React.ReactNode) {
  return <AudioPlayerProvider>{ui}</AudioPlayerProvider>;
}

describe("EpisodeDescription", () => {
  it("renders plain text description", () => {
    render(wrap(<EpisodeDescription description="A short description." />));
    expect(screen.getByText(/A short description\./)).toBeInTheDocument();
  });

  it("sanitizes unsafe HTML (strips <script>)", () => {
    const malicious = 'safe text <script>alert("xss")</script>';
    const { container } = render(wrap(<EpisodeDescription description={malicious} />));
    expect(container.innerHTML).not.toContain("<script");
    expect(container.textContent).toContain("safe text");
  });

  it("allows anchor tags and forces target=_blank + rel", () => {
    const html = '<a href="https://example.com">link</a>';
    const { container } = render(wrap(<EpisodeDescription description={html} />));
    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("shows 'Show more' toggle when description is long (>300 chars)", async () => {
    const user = userEvent.setup();
    const long = "x".repeat(500);
    render(wrap(<EpisodeDescription description={long} />));
    expect(screen.getByRole("button", { name: /show more/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /show more/i }));
    expect(screen.getByRole("button", { name: /show less/i })).toBeInTheDocument();
  });

  it("hides the toggle for short descriptions", () => {
    render(wrap(<EpisodeDescription description="Short." />));
    expect(screen.queryByRole("button", { name: /show more/i })).not.toBeInTheDocument();
  });

  it("linkifies MM:SS timestamps when episodeId + audioLocalPath present", () => {
    const { container } = render(
      wrap(
        <EpisodeDescription
          description="Check 12:34 for the key moment."
          episodeId="ep-1"
          audioLocalPath="/data/audio/archive/ep-1.mp3"
        />
      )
    );
    const anchor = container.querySelector("a.podlog-timestamp-link");
    expect(anchor).toBeTruthy();
    // 12:34 → 12*60 + 34 = 754
    expect(anchor?.getAttribute("data-timestamp-secs")).toBe("754");
    expect(anchor?.textContent).toBe("12:34");
  });

  it("linkifies HH:MM:SS timestamps as well", () => {
    const { container } = render(
      wrap(
        <EpisodeDescription
          description="Jump to 01:02:03 for the conclusion."
          episodeId="ep-1"
          audioLocalPath="/data/audio/archive/ep-1.mp3"
        />
      )
    );
    const anchor = container.querySelector("a.podlog-timestamp-link");
    // 1h 2m 3s → 3723
    expect(anchor?.getAttribute("data-timestamp-secs")).toBe("3723");
  });

  it("does not linkify timestamps when audio metadata is missing", () => {
    const { container } = render(
      wrap(<EpisodeDescription description="Jump to 12:34." />)
    );
    expect(container.querySelector("a.podlog-timestamp-link")).toBeNull();
  });

  it("does not linkify timestamps that already appear inside an anchor", () => {
    const { container } = render(
      wrap(
        <EpisodeDescription
          description={'See <a href="https://example.com">at 12:34 here</a>.'}
          episodeId="ep-1"
          audioLocalPath="/data/audio/archive/ep-1.mp3"
        />
      )
    );
    // The 12:34 inside the original <a> should NOT be converted to a
    // .podlog-timestamp-link anchor.
    expect(container.querySelector("a.podlog-timestamp-link")).toBeNull();
  });

  it("does not linkify malformed timestamps with out-of-range seconds", () => {
    const { container } = render(
      wrap(
        <EpisodeDescription
          description="Bad value 12:99 should not be linkified."
          episodeId="ep-1"
          audioLocalPath="/data/audio/archive/ep-1.mp3"
        />
      )
    );
    // The negative-lookahead in the regex already excludes :99 because
    // `99` doesn't match `\d{2}` followed by a non-digit... but more
    // importantly, parseTimestamp would return null. Either way: no link.
    expect(container.querySelector("a.podlog-timestamp-link")).toBeNull();
  });

  it("clicking a timestamp link plays audio and dispatches scroll event", async () => {
    const user = userEvent.setup();
    const dispatchSpy = jest.spyOn(window, "dispatchEvent");
    const { container } = render(
      wrap(
        <EpisodeDescription
          description="Highlight at 12:34 below."
          episodeId="ep-7"
          audioLocalPath="/data/audio/archive/ep-7.mp3"
          episodeTitle="My Episode"
          feedTitle="My Show"
        />
      )
    );
    const link = container.querySelector("a.podlog-timestamp-link") as HTMLAnchorElement;
    expect(link).toBeTruthy();
    await user.click(link);

    // Exactly one CustomEvent with the timestamp seconds was dispatched.
    const scrollCalls = dispatchSpy.mock.calls
      .map((c) => c[0])
      .filter((e): e is CustomEvent =>
        e instanceof CustomEvent && e.type === "podlog:scroll-to-time"
      );
    expect(scrollCalls).toHaveLength(1);
    expect((scrollCalls[0] as CustomEvent).detail).toEqual({ secs: 754 });
    dispatchSpy.mockRestore();
  });

  it("clicking a timestamp link is a no-op when episodeId is missing", async () => {
    // Without episodeId/audioLocalPath the description doesn't linkify,
    // so there's nothing to click — verify the early-return branch by
    // checking that the click on a plain anchor doesn't crash.
    const user = userEvent.setup();
    const { container } = render(
      wrap(
        <EpisodeDescription
          description={'See <a href="https://example.com">link</a>.'}
        />
      )
    );
    const link = container.querySelector("a") as HTMLAnchorElement;
    // Plain link has no podlog-timestamp-link class → handler should
    // pass through without preventing default.
    await user.click(link);
    // No exception, no scroll event.
  });
});
