import { render, screen, fireEvent } from "@testing-library/react";
import PodcastsList, {
  type PodcastsListFeed,
} from "@/components/PodcastsList";

// next/image complains in a jsdom environment about width/height vs fill; stub it.
jest.mock("next/image", () => ({
  __esModule: true,
  default: ({ alt, src }: { alt: string; src: string }) => (
    <img alt={alt} src={src} />
  ),
}));

const STORAGE_KEY = "podlog-podcasts-view";

function makeFeed(overrides: Partial<PodcastsListFeed> = {}): PodcastsListFeed {
  return {
    id: "feed-1",
    title: "Example Podcast",
    description: "A pod about things.",
    image_url: "https://example.com/art.jpg",
    mode: "full",
    episode_count: 10,
    processed_count: 10,
    last_polled_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("<PodcastsList>", () => {
  it("renders grid view by default and shows the Manage feeds link", () => {
    render(<PodcastsList feeds={[makeFeed()]} />);
    const root = screen.getByText("Example Podcast").closest("[data-view]");
    expect(root?.getAttribute("data-view")).toBe("grid");
    expect(screen.getByRole("link", { name: /Manage feeds/ })).toHaveAttribute(
      "href",
      "/feeds",
    );
  });

  it("hydrates the view from localStorage on mount", () => {
    window.localStorage.setItem(STORAGE_KEY, "list");
    render(<PodcastsList feeds={[makeFeed()]} />);
    const root = screen.getByText("Example Podcast").closest("[data-view]");
    expect(root?.getAttribute("data-view")).toBe("list");
  });

  it("ignores garbage values in localStorage and falls back to grid", () => {
    window.localStorage.setItem(STORAGE_KEY, "carousel");
    render(<PodcastsList feeds={[makeFeed()]} />);
    const root = screen.getByText("Example Podcast").closest("[data-view]");
    expect(root?.getAttribute("data-view")).toBe("grid");
  });

  it("persists the selected view to localStorage on toggle", () => {
    render(<PodcastsList feeds={[makeFeed()]} />);
    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("list");
    fireEvent.click(screen.getByRole("button", { name: "Large tiles" }));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("large");
  });

  it("marks the active toggle with aria-pressed", () => {
    render(<PodcastsList feeds={[makeFeed()]} initialView="grid" />);
    expect(screen.getByRole("button", { name: "Grid view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Grid view" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("renders the feed title in every view", () => {
    const feed = makeFeed({ title: "Unique Title" });
    for (const view of ["list", "grid", "large"] as const) {
      const { unmount } = render(
        <PodcastsList feeds={[feed]} initialView={view} />,
      );
      expect(screen.getByText("Unique Title")).toBeInTheDocument();
      unmount();
    }
  });

  it("renders the description only in large view", () => {
    const feed = makeFeed({ description: "Look, a description!" });
    const { unmount: u1 } = render(
      <PodcastsList feeds={[feed]} initialView="grid" />,
    );
    expect(screen.queryByText("Look, a description!")).not.toBeInTheDocument();
    u1();

    const { unmount: u2 } = render(
      <PodcastsList feeds={[feed]} initialView="list" />,
    );
    expect(screen.queryByText("Look, a description!")).not.toBeInTheDocument();
    u2();

    render(<PodcastsList feeds={[feed]} initialView="large" />);
    expect(screen.getByText("Look, a description!")).toBeInTheDocument();
  });

  it("shows the processed/total counter when not all episodes are done", () => {
    render(
      <PodcastsList
        feeds={[makeFeed({ episode_count: 10, processed_count: 3 })]}
      />,
    );
    // Appears in both the header aggregate and the feed card — assert at least one.
    expect(
      screen.getAllByText(/3 \/ 10 episodes processed/).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("shows only total when all episodes are processed", () => {
    render(
      <PodcastsList
        feeds={[makeFeed({ episode_count: 5, processed_count: 5 })]}
      />,
    );
    expect(screen.getAllByText(/^5 episodes$/).length).toBeGreaterThanOrEqual(1);
  });

  it("renders the Test and Selective badges based on mode", () => {
    const { rerender } = render(
      <PodcastsList feeds={[makeFeed({ mode: "test" })]} />,
    );
    expect(screen.getByText("Test")).toBeInTheDocument();
    expect(screen.queryByText("Selective")).not.toBeInTheDocument();

    rerender(<PodcastsList feeds={[makeFeed({ mode: "selective" })]} />);
    expect(screen.getByText("Selective")).toBeInTheDocument();
    expect(screen.queryByText("Test")).not.toBeInTheDocument();

    rerender(<PodcastsList feeds={[makeFeed({ mode: "full" })]} />);
    expect(screen.queryByText("Test")).not.toBeInTheDocument();
    expect(screen.queryByText("Selective")).not.toBeInTheDocument();
  });

  it("renders each feed as a link to its detail page", () => {
    render(
      <PodcastsList
        feeds={[makeFeed({ id: "a" }), makeFeed({ id: "b", title: "Pod B" })]}
      />,
    );
    const links = screen.getAllByRole("link");
    expect(
      links.some((l) => l.getAttribute("href") === "/podcasts/a"),
    ).toBe(true);
    expect(
      links.some((l) => l.getAttribute("href") === "/podcasts/b"),
    ).toBe(true);
  });
});
