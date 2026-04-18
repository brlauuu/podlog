/**
 * Tests for the server-component /about page.
 *
 * The page reads docs/about.md from disk. We mock fs/promises to
 * exercise both the success path (markdown shown via a stubbed
 * ReactMarkdown) and the fallback path (file missing → "Could not
 * load" message). react-markdown + remark/rehype are ESM-only; we
 * stub them to a plain renderer that exposes the link-mapper logic
 * the page defines.
 */
const mockReadFile = jest.fn();
jest.mock("fs/promises", () => ({ readFile: mockReadFile }));

type LinkProps = {
  href?: string;
  children?: React.ReactNode;
};
type ComponentsMap = { a?: (p: LinkProps) => React.ReactElement };
type MarkdownProps = { components?: ComponentsMap; children?: string };

jest.mock(
  "react-markdown",
  () => ({
    __esModule: true,
    default: ({ children, components }: MarkdownProps) => {
      const Link = components?.a;
      const text = children ?? "";
      const linkMatch = /\[([^\]]+)\]\(([^)]+)\)/.exec(text);
      return (
        <div data-testid="markdown">
          {linkMatch && Link
            ? Link({ href: linkMatch[2], children: linkMatch[1] })
            : text}
        </div>
      );
    },
  }),
  { virtual: true }
);
jest.mock("remark-gfm", () => ({ __esModule: true, default: () => null }), {
  virtual: true,
});
jest.mock("rehype-raw", () => ({ __esModule: true, default: () => null }), {
  virtual: true,
});

import React from "react";
import { render, screen } from "@testing-library/react";

type PageModule = typeof import("@/app/about/page");
let AboutPage: PageModule["default"];

beforeAll(async () => {
  const mod: PageModule = await import("@/app/about/page");
  AboutPage = mod.default;
});

beforeEach(() => {
  mockReadFile.mockReset();
});

describe("<AboutPage>", () => {
  it("marks external links with target=_blank and rel=noopener", async () => {
    mockReadFile.mockResolvedValue("See [example](https://example.com/x).");

    const jsx = await AboutPage();
    render(jsx);

    const link = screen.getByRole("link", { name: "example" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("does not set target/rel for relative links", async () => {
    mockReadFile.mockResolvedValue("See [docs](/docs) for more.");

    const jsx = await AboutPage();
    render(jsx);

    const link = screen.getByRole("link", { name: "docs" });
    expect(link).not.toHaveAttribute("target");
    expect(link).not.toHaveAttribute("rel");
  });

  it("renders the fallback block when about.md is missing", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    const jsx = await AboutPage();
    render(jsx);

    expect(screen.getByRole("heading", { name: "About" })).toBeInTheDocument();
    expect(
      screen.getByText("Could not load the About page.")
    ).toBeInTheDocument();
  });
});
