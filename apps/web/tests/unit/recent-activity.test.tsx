/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, within, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

jest.mock("next/link", () => {
  return ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  );
});
jest.mock("next/image", () => {
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  return (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />;
});

import RecentActivity, { RecentEpisode, ROW_HEIGHT, VISIBLE_ROWS } from "@/components/RecentActivity";

function ep(n: number, over: Partial<RecentEpisode> = {}): RecentEpisode {
  return {
    episode_id: `ep-${n}`,
    title: `Episode ${n}`,
    published_at: "2026-10-14T20:05:00Z",
    feed_title: `Podcast ${n}`,
    feed_image_url: `https://example.com/${n}.jpg`,
    outcome: "done",
    finished_at: "2026-10-17T15:40:00Z",
    ...over,
  };
}

function respond(body: unknown, ok = true) {
  global.fetch = jest.fn().mockResolvedValue({ ok, json: () => Promise.resolve(body) }) as unknown as typeof fetch;
}

beforeEach(() => {
  // jsdom has no layout or animation; a no-op rAF keeps the roller still.
  window.requestAnimationFrame = jest.fn(() => 1);
  window.cancelAnimationFrame = jest.fn();
});

describe("RecentActivity (#1079)", () => {
  it("renders nothing when nothing was processed this week", async () => {
    respond([]);
    const { container } = render(<RecentActivity />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/queue/recent"));
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the read fails", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("down")) as unknown as typeof fetch;
    const { container } = render(<RecentActivity />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows podcast, title, publish date and a status per card, linking to the episode", async () => {
    respond([ep(1), ep(2, { outcome: "failed", feed_image_url: null, published_at: "2019-03-14T12:00:00Z" })]);
    render(<RecentActivity />);

    const list = await screen.findByRole("list", { name: "Processed this week" });
    const [first, second] = within(list).getAllByRole("link");

    expect(first).toHaveAttribute("href", "/episodes/ep-1");
    expect(first).toHaveTextContent("Podcast 1");
    expect(first).toHaveTextContent("Episode 1");
    expect(first).toHaveTextContent("Processed");
    expect(first).toHaveTextContent(/14\/10$/);
    expect(first.querySelector("img")).toHaveAttribute("src", "https://example.com/1.jpg");
    expect(first.querySelector(".bg-green-600")).not.toBeNull();

    expect(second).toHaveAttribute("href", "/episodes/ep-2");
    expect(second).toHaveTextContent("Failed");
    expect(second).toHaveTextContent("14/03/2019");
    expect(second.querySelector("img")).toBeNull();
    expect(second.querySelector(".bg-red-600")).not.toBeNull();
  });

  it("does not roll or fade three or fewer entries", async () => {
    respond([ep(1), ep(2), ep(3)]);
    render(<RecentActivity />);
    await screen.findByRole("list", { name: "Processed this week" });

    expect(screen.queryByTestId("recent-activity-roller")).toBeNull();
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("rolls more than three, three rows tall, with one accessible copy", async () => {
    respond([ep(1), ep(2), ep(3), ep(4)]);
    render(<RecentActivity />);

    const roller = await screen.findByTestId("recent-activity-roller");
    expect(roller).toHaveStyle({ height: `${ROW_HEIGHT * VISIBLE_ROWS}px` });
    expect(window.requestAnimationFrame).toHaveBeenCalled();
    // Three copies make the wrap seamless, but only one is exposed.
    expect(roller.querySelectorAll("a")).toHaveLength(12);
    expect(screen.getAllByRole("link")).toHaveLength(4);
    const hidden = roller.querySelectorAll('[aria-hidden="true"] a');
    expect(hidden).toHaveLength(8);
    hidden.forEach((a) => expect(a).toHaveAttribute("tabindex", "-1"));
  });

  it("does not roll on its own when reduced motion is requested", async () => {
    window.matchMedia = jest.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    respond([ep(1), ep(2), ep(3), ep(4)]);
    render(<RecentActivity />);

    await screen.findByTestId("recent-activity-roller");
    expect(window.matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    // @ts-expect-error -- jsdom has no matchMedia; restore that
    delete window.matchMedia;
  });
});
