/**
 * DocsClient — the markdown component renderers and the docs search UI (#912).
 *
 * docs.test.tsx mocks react-markdown wholesale, so the custom `components`
 * renderers (heading ids, link resolution) were never invoked. This mock
 * instead calls them with representative children, which exercises the real
 * renderer bodies without pulling in the library.
 *
 * @jest-environment jsdom
 */
import React, { type ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

type Renderers = {
  h2?: (p: { children: ReactNode }) => ReactNode;
  h3?: (p: { children: ReactNode }) => ReactNode;
  a?: (p: { href?: string; children: ReactNode }) => ReactNode;
};

jest.mock("react-markdown", () => {
  function MockReactMarkdown({
    children,
    components,
  }: {
    children: ReactNode;
    components?: Renderers;
  }) {
    return (
      <div data-testid="markdown-content">
        {components?.h2?.({ children: "Getting Started" })}
        {components?.h3?.({ children: "Sub Section" })}
        {components?.a?.({ href: "01-installation.md", children: "internal link" })}
        {components?.a?.({ href: "https://example.com", children: "external link" })}
        {components?.a?.({ href: undefined, children: "no href" })}
        {children}
      </div>
    );
  }
  return MockReactMarkdown;
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

const DOCS = [
  { name: "README", title: "README" },
  { name: "01-installation", title: "Installation" },
];

const SEARCH_INDEX = [
  {
    docSlug: "01-installation",
    docTitle: "Installation",
    sectionId: "requirements",
    sectionTitle: "Requirements",
    content: "You need Docker and Docker Compose to run the stack locally.",
  },
  {
    docSlug: "README",
    docTitle: "README",
    sectionId: "",
    sectionTitle: "README",
    content: "Podlog is a self-hosted podcast transcription and search app.",
  },
];

const push = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockUseSearchParams.mockReturnValue({ get: () => "README" });
  mockUseRouter.mockReturnValue({ push, replace: jest.fn() });
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    text: () => Promise.resolve("# Doc\n\nBody"),
  });
});

describe("DocsClient — markdown renderers", () => {
  test("headings get slugified ids so anchor links land correctly", async () => {
    const { container } = render(<DocsClient docs={DOCS} searchIndex={[]} />);

    await waitFor(() => expect(screen.getByTestId("markdown-content")).toBeInTheDocument());

    const h2 = container.querySelector("h2#getting-started");
    const h3 = container.querySelector("h3#sub-section");
    expect(h2).toBeInTheDocument();
    expect(h3).toBeInTheDocument();
    // scroll-mt-24 keeps the heading clear of the sticky navbar (#729).
    expect(h2).toHaveClass("scroll-mt-24");
  });

  test("internal .md links resolve to /docs routes, external links stay absolute", async () => {
    render(<DocsClient docs={DOCS} searchIndex={[]} />);

    await waitFor(() => expect(screen.getByTestId("markdown-content")).toBeInTheDocument());

    const internal = screen.getByText("internal link").closest("a");
    const external = screen.getByText("external link").closest("a");

    expect(internal).toHaveAttribute("href", expect.stringContaining("/docs?page=01-installation"));
    expect(external).toHaveAttribute("href", "https://example.com");
    expect(external).toHaveAttribute("target", "_blank");
  });
});

describe("DocsClient — search", () => {
  test("typing shows matching sections and clears via the X button", async () => {
    render(<DocsClient docs={DOCS} searchIndex={SEARCH_INDEX} />);

    const box = screen.getByLabelText("Search documentation");
    fireEvent.change(box, { target: { value: "docker" } });

    expect(await screen.findByText(/Requirements/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Clear search"));
    await waitFor(() => expect(screen.queryByText(/Requirements/)).not.toBeInTheDocument());
  });

  test("Escape clears the query", async () => {
    render(<DocsClient docs={DOCS} searchIndex={SEARCH_INDEX} />);

    const box = screen.getByLabelText("Search documentation");
    fireEvent.change(box, { target: { value: "docker" } });
    expect(await screen.findByText(/Requirements/)).toBeInTheDocument();

    fireEvent.keyDown(box, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText(/Requirements/)).not.toBeInTheDocument());
  });

  test("clicking a hit navigates to that doc and anchor", async () => {
    render(<DocsClient docs={DOCS} searchIndex={SEARCH_INDEX} />);

    fireEvent.change(screen.getByLabelText("Search documentation"), {
      target: { value: "docker" },
    });

    const hit = await screen.findByText(/Requirements/);
    fireEvent.click(hit.closest("button")!);

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/docs?page=01-installation#requirements")
    );
  });

  test("the mobile select navigates to the chosen doc", async () => {
    render(<DocsClient docs={DOCS} searchIndex={[]} />);

    fireEvent.change(screen.getByLabelText("Choose document"), {
      target: { value: "01-installation" },
    });

    expect(push).toHaveBeenCalledWith("/docs?page=01-installation");
  });
});

describe("DocsClient — empty state", () => {
  test("explains the missing mount when no docs are present", () => {
    render(<DocsClient docs={[]} searchIndex={[]} />);

    expect(screen.getByText(/No markdown docs were found/i)).toBeInTheDocument();
    // The mount path appears in both the prose and the <code> element; assert
    // on the <code> so the matcher can't drift onto the surrounding sentence.
    expect(screen.getByText("/docs/guide", { selector: "code" })).toBeInTheDocument();
  });
});
