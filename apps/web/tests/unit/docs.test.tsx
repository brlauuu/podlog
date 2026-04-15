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
import { extractTocItems, slugifyHeading } from "@/app/docs/DocsClient";

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

  it("renders knowledge base sidebar with all docs", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("# Test Doc\n\nHello world"),
    });

    render(<DocsClient docs={mockDocs} />);

    expect(screen.getByText("Knowledge base")).toBeInTheDocument();
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

  it("renders right-side table of contents from h2/h3 headings", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(
        "# Test Doc\n\n## Overview\n\n### Quick Start\n\n## Troubleshooting"
      ),
    });

    render(<DocsClient docs={mockDocs} />);

    await waitFor(() => {
      expect(screen.getByText("On this page")).toBeInTheDocument();
    });

    expect(screen.getByRole("link", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Quick Start" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Troubleshooting" })).toBeInTheDocument();
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

describe("docs heading helpers", () => {
  it("slugifies heading text", () => {
    expect(slugifyHeading("Quick Start!")).toBe("quick-start");
    expect(slugifyHeading("  Many   Spaces ")).toBe("many-spaces");
  });

  it("extracts unique h2/h3 toc items", () => {
    const toc = extractTocItems("## Overview\n### Setup\n## Overview");
    expect(toc).toEqual([
      { id: "overview", level: 2, text: "Overview" },
      { id: "setup", level: 3, text: "Setup" },
      { id: "overview-1", level: 2, text: "Overview" },
    ]);
  });
});
