/**
 * @jest-environment jsdom
 */
/**
 * Smoke tests for the /docs page entry component (#672). It is a thin
 * wrapper that delegates to a client component;
 * the goal here is to exercise the entry surface (props passed, dir
 * read fallback) so the lines aren't 0%.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockBuildDocsIndex = jest.fn();
jest.mock("@/lib/docs-index", () => ({
  buildDocsIndex: (...args: unknown[]) => mockBuildDocsIndex(...args),
}));

jest.mock("@/app/docs/DocsClient", () => ({
  __esModule: true,
  default: ({
    docs,
    searchIndex,
  }: {
    docs: { name: string; title: string }[];
    searchIndex: unknown;
  }) => (
    <div data-testid="docs-client">
      <span data-testid="docs-count">{docs.length}</span>
      <span data-testid="docs-titles">
        {docs.map((d) => d.title).join("|")}
      </span>
      <span data-testid="docs-search-index">
        {searchIndex === null ? "null" : "present"}
      </span>
    </div>
  ),
}));

const mockReaddir = jest.fn();
jest.mock("fs/promises", () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
}));

import DocsPage from "@/app/docs/page";

beforeEach(() => {
  mockReaddir.mockReset();
  mockBuildDocsIndex.mockReset();
});

describe("/docs entry", () => {
  it("lists discovered .md docs and forwards the search index", async () => {
    mockReaddir.mockResolvedValue([
      "01-getting-started.md",
      "02-architecture.md",
      "not-a-doc.txt",
    ]);
    mockBuildDocsIndex.mockResolvedValue({ chunks: [] });

    const ui = await DocsPage();
    render(ui);

    expect(screen.getByTestId("docs-client")).toBeInTheDocument();
    expect(screen.getByTestId("docs-count")).toHaveTextContent("2");
    // filenameToTitle strips leading "NN-" and Title-Cases the rest.
    expect(screen.getByTestId("docs-titles")).toHaveTextContent(
      "Getting Started|Architecture",
    );
    expect(screen.getByTestId("docs-search-index")).toHaveTextContent("present");
  });

  it("falls back to an empty docs list when the directory read fails", async () => {
    mockReaddir.mockRejectedValue(new Error("ENOENT"));
    mockBuildDocsIndex.mockResolvedValue(null);

    const ui = await DocsPage();
    render(ui);

    expect(screen.getByTestId("docs-client")).toBeInTheDocument();
    expect(screen.getByTestId("docs-count")).toHaveTextContent("0");
    expect(screen.getByTestId("docs-search-index")).toHaveTextContent("null");
  });
});
