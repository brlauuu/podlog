import { render, screen, fireEvent } from "@testing-library/react";
import FeedCard from "@/components/FeedCard";

type Feed = Parameters<typeof FeedCard>[0]["feed"];

function makeFeed(overrides: Partial<Feed> = {}): Feed {
  return {
    id: "feed-1",
    url: "https://example.com/rss.xml",
    title: "Example Feed",
    mode: "full",
    last_polled_at: null,
    episode_count: 12,
    ...overrides,
  };
}

function renderCard(feed: Feed, pollPending = false) {
  const onPromote = jest.fn();
  const onPoll = jest.fn();
  const onDelete = jest.fn();
  const result = render(
    <FeedCard
      feed={feed}
      pollPending={pollPending}
      onPromote={onPromote}
      onPoll={onPoll}
      onDelete={onDelete}
    />
  );
  return { onPromote, onPoll, onDelete, ...result };
}

describe("<FeedCard>", () => {
  it("renders the feed title when present, otherwise the URL", () => {
    const { rerender } = renderCard(makeFeed({ title: "My Podcast" }));
    expect(screen.getByText("My Podcast")).toBeInTheDocument();

    rerender(
      <FeedCard
        feed={makeFeed({ title: null, url: "https://ex.com/x.xml" })}
        pollPending={false}
        onPromote={jest.fn()}
        onPoll={jest.fn()}
        onDelete={jest.fn()}
      />
    );
    expect(screen.getAllByText("https://ex.com/x.xml")[0]).toBeInTheDocument();
  });

  it("shows 'Never polled' when last_polled_at is null", () => {
    renderCard(makeFeed({ last_polled_at: null, episode_count: 5 }));
    expect(screen.getByText(/5 episodes · Never polled/)).toBeInTheDocument();
  });

  it("formats last_polled_at with toLocaleString when set", () => {
    const when = "2026-04-18T10:30:00Z";
    renderCard(makeFeed({ last_polled_at: when, episode_count: 1 }));
    const expected = new Date(when).toLocaleString();
    expect(screen.getByText(new RegExp(`Last polled ${expected.replace(/[\\/.*+?^${}()|[\]]/g, "\\$&")}`))).toBeInTheDocument();
  });

  it("renders Test badge only when mode=test", () => {
    renderCard(makeFeed({ mode: "test" }));
    expect(screen.getByText("Test")).toBeInTheDocument();
    expect(screen.queryByText("Selective")).not.toBeInTheDocument();
  });

  it("renders Selective badge only when mode=selective", () => {
    renderCard(makeFeed({ mode: "selective" }));
    expect(screen.getByText("Selective")).toBeInTheDocument();
    expect(screen.queryByText("Test")).not.toBeInTheDocument();
  });

  it("shows Promote button only for test and selective modes", () => {
    const { rerender } = renderCard(makeFeed({ mode: "full" }));
    expect(screen.queryByRole("button", { name: /Promote to Full/ })).not.toBeInTheDocument();

    for (const mode of ["test", "selective"]) {
      rerender(
        <FeedCard
          feed={makeFeed({ mode })}
          pollPending={false}
          onPromote={jest.fn()}
          onPoll={jest.fn()}
          onDelete={jest.fn()}
        />
      );
      expect(
        screen.getByRole("button", { name: /Promote to Full/ })
      ).toBeInTheDocument();
    }
  });

  it("hides Poll button for selective mode; shows it otherwise", () => {
    const { rerender } = renderCard(makeFeed({ mode: "selective" }));
    expect(screen.queryByRole("button", { name: "Poll now" })).not.toBeInTheDocument();

    rerender(
      <FeedCard
        feed={makeFeed({ mode: "full" })}
        pollPending={false}
        onPromote={jest.fn()}
        onPoll={jest.fn()}
        onDelete={jest.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "Poll now" })).toBeInTheDocument();
  });

  it("disables poll button and spins icon when pollPending", () => {
    renderCard(makeFeed({ mode: "full" }), true);
    const pollBtn = screen.getByRole("button", { name: "Poll now" });
    expect(pollBtn).toBeDisabled();
    expect(pollBtn.querySelector("svg")?.getAttribute("class") ?? "").toContain(
      "animate-spin"
    );
  });

  it("invokes the callbacks with the right arguments", () => {
    const { onPromote, onPoll, onDelete } = renderCard(
      makeFeed({ mode: "test", url: "https://ex.com/y.xml", id: "feed-42" })
    );
    fireEvent.click(screen.getByRole("button", { name: /Promote to Full/ }));
    fireEvent.click(screen.getByRole("button", { name: "Poll now" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove feed" }));

    expect(onPromote).toHaveBeenCalledWith("https://ex.com/y.xml");
    expect(onPoll).toHaveBeenCalledWith("feed-42");
    expect(onDelete).toHaveBeenCalledWith("feed-42");
  });

  // Issue #487
  it("renders 'Add episodes' only for selective feeds and invokes onAddMore", () => {
    const onAddMore = jest.fn();
    const { rerender } = render(
      <FeedCard
        feed={makeFeed({ mode: "full" })}
        pollPending={false}
        onPromote={jest.fn()}
        onPoll={jest.fn()}
        onDelete={jest.fn()}
        onAddMore={onAddMore}
      />
    );
    expect(screen.queryByRole("button", { name: /Add episodes/ })).not.toBeInTheDocument();

    const selective = makeFeed({ mode: "selective", id: "feed-7" });
    rerender(
      <FeedCard
        feed={selective}
        pollPending={false}
        onPromote={jest.fn()}
        onPoll={jest.fn()}
        onDelete={jest.fn()}
        onAddMore={onAddMore}
      />
    );
    const btn = screen.getByRole("button", { name: /Add episodes/ });
    fireEvent.click(btn);
    expect(onAddMore).toHaveBeenCalledWith(selective);
  });

  it("does not render 'Add episodes' for selective feeds when onAddMore is not supplied", () => {
    renderCard(makeFeed({ mode: "selective" }));
    expect(screen.queryByRole("button", { name: /Add episodes/ })).not.toBeInTheDocument();
  });
});
