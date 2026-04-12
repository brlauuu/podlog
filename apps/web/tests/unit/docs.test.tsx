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

describe("DocsClient", () => {
  const mockDocs = [
    { name: "README", title: "README" },
    { name: "01-installation", title: "Installation" },
    { name: "02-first-run", title: "First Run" },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSearchParams.mockReturnValue({
      get: () => "README",
    });
    mockUseRouter.mockReturnValue({
      push: jest.fn(),
    });
    global.fetch = jest.fn();
  });

  it("renders sidebar with all docs", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("# Test Doc\n\nHello world"),
    });

    render(<DocsClient docs={mockDocs} />);

    expect(screen.getByText("README")).toBeInTheDocument();
    expect(screen.getByText("Installation")).toBeInTheDocument();
    expect(screen.getByText("First Run")).toBeInTheDocument();
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
});