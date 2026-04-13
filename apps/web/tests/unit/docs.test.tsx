/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

jest.mock("react-markdown", () => function MockReactMarkdown({ children }: { children: React.ReactNode }) {
  return <div data-testid="markdown-content">{children}</div>;
});

jest.mock("remark-gfm", () => ({}), { virtual: true });
jest.mock("rehype-raw", () => ({}), { virtual: true });

const mockUseSearchParams = jest.fn();
const mockUseRouter = jest.fn();

jest.mock("next/navigation", () => ({
  useSearchParams: () => mockUseSearchParams(),
  useRouter: () => mockUseRouter(),
}));

import DocsClient from "@/app/docs/DocsClient";
import { resolveMarkdownHref } from "@/app/docs/DocsClient";

describe("DocsClient", () => {
  const mockDocs = [
    { name: "README", title: "README" },
    { name: "01-installation", title: "Installation" },
    { name: "02-first-run", title: "First Run" },
  ];
  const mockPush = jest.fn();
  const mockReplace = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSearchParams.mockReturnValue({
      get: () => "README",
    });
    mockUseRouter.mockReturnValue({
      push: mockPush,
      replace: mockReplace,
    });
    global.fetch = jest.fn();
  });

  it("renders sidebar with all docs", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("# Test Doc\n\nHello world"),
    });

    render(<DocsClient docs={mockDocs} />);

    expect(screen.getByRole("button", { name: "README" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Installation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "First Run" })).toBeInTheDocument();
  });

  it("renders markdown content", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("# Test Doc\n\nHello world"),
    });

    render(<DocsClient docs={mockDocs} />);

    await waitFor(() => {
      expect(screen.getByText(/Test Doc/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Hello world/)).toBeInTheDocument();
  });

  it("shows loading state while fetching", async () => {
    (global.fetch as jest.Mock).mockImplementation(
      () => new Promise(() => {}) // never resolves
    );

    render(<DocsClient docs={mockDocs} />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows error state when doc not found", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
    });

    render(<DocsClient docs={mockDocs} />);

    await waitFor(() => {
      expect(screen.getByText("Could not load the requested page.")).toBeInTheDocument();
    });
  });

  it("shows empty state when docs list is empty", async () => {
    render(<DocsClient docs={[]} />);
    expect(screen.getByText("No markdown docs were found.")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("redirects invalid page query to default docs page", async () => {
    mockUseSearchParams.mockReturnValue({
      get: () => "not-a-doc",
    });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("# README"),
    });

    render(<DocsClient docs={mockDocs} />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/docs?page=README");
    });
  });
});

describe("resolveMarkdownHref", () => {
  const docs = [
    { name: "README", title: "README" },
    { name: "01-installation", title: "Installation" },
    { name: "08-queue", title: "Queue" },
  ];

  it("maps guide markdown links to in-app docs routes", () => {
    expect(resolveMarkdownHref("01-installation.md", docs)).toBe("/docs?page=01-installation");
    expect(resolveMarkdownHref("./08-queue.md#pipeline-stages", docs)).toBe(
      "/docs?page=08-queue#pipeline-stages"
    );
  });

  it("maps non-guide markdown links to GitHub blob URLs", () => {
    expect(resolveMarkdownHref("../configuration.md", docs)).toBe(
      "https://github.com/brlauuu/podlog/blob/main/docs/configuration.md"
    );
    expect(resolveMarkdownHref("../../README.md", docs)).toBe(
      "https://github.com/brlauuu/podlog/blob/main/README.md"
    );
  });

  it("leaves external, absolute, and hash links unchanged", () => {
    expect(resolveMarkdownHref("https://example.com", docs)).toBe("https://example.com");
    expect(resolveMarkdownHref("/search", docs)).toBe("/search");
    expect(resolveMarkdownHref("#top", docs)).toBe("#top");
  });
});
