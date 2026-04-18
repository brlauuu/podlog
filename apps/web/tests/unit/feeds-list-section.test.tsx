import { render, screen, fireEvent } from "@testing-library/react";
import FeedsListSection from "@/components/FeedsListSection";

type Feed = Parameters<typeof FeedsListSection>[0]["feeds"][number];

function feed(overrides: Partial<Feed> = {}): Feed {
  return {
    id: "feed-1",
    url: "https://ex.com/rss.xml",
    title: "F1",
    mode: "full",
    last_polled_at: null,
    episode_count: 1,
    ...overrides,
  };
}

function renderSection(overrides: Partial<React.ComponentProps<typeof FeedsListSection>> = {}) {
  const onAddFirstFeed = jest.fn();
  const onPromote = jest.fn();
  const onPoll = jest.fn();
  const onDelete = jest.fn();

  const result = render(
    <FeedsListSection
      isLoading={false}
      feeds={[]}
      pollPendingId={null}
      onAddFirstFeed={onAddFirstFeed}
      onPromote={onPromote}
      onPoll={onPoll}
      onDelete={onDelete}
      {...overrides}
    />
  );
  return { onAddFirstFeed, onPromote, onPoll, onDelete, ...result };
}

describe("<FeedsListSection>", () => {
  it("renders skeleton rows when loading", () => {
    const { container } = renderSection({ isLoading: true });
    const skeletons = container.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBe(9);
  });

  it("renders an empty state + 'Add your first RSS feed' button when no feeds", () => {
    const { onAddFirstFeed } = renderSection({ feeds: [] });
    expect(screen.getByText(/No feeds yet\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Add your first RSS feed/ }));
    expect(onAddFirstFeed).toHaveBeenCalledTimes(1);
  });

  it("renders a FeedCard for each feed", () => {
    renderSection({
      feeds: [feed({ id: "a", title: "A" }), feed({ id: "b", title: "B" })],
    });
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("passes pollPending=true only for the feed whose id matches pollPendingId", () => {
    renderSection({
      feeds: [
        feed({ id: "a", title: "A", mode: "full" }),
        feed({ id: "b", title: "B", mode: "full" }),
      ],
      pollPendingId: "a",
    });
    const pollButtons = screen.getAllByRole("button", { name: "Poll now" });
    expect(pollButtons).toHaveLength(2);
    expect(pollButtons[0]).toBeDisabled();
    expect(pollButtons[1]).not.toBeDisabled();
  });
});
