/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import ExploreStatusPanel from "@/app/meta-analysis/ExploreStatusPanel";

jest.mock("next/link", () => {
  function MockLink({ href, children, ...props }: { href: string; children: React.ReactNode }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  }
  MockLink.displayName = "MockLink";
  return MockLink;
});

function mockFetch(status: { running: boolean; url: string | null; error: string | null }) {
  return jest.fn(() =>
    Promise.resolve({ json: async () => status } as Response),
  ) as jest.Mock;
}

describe("<ExploreStatusPanel> (#607 PR 2)", () => {
  test("renders nothing while the probe is in flight", () => {
    // Long-pending fetch — the panel should be empty until it resolves.
    global.fetch = jest.fn(() => new Promise(() => {})) as jest.Mock;
    const { container } = render(<ExploreStatusPanel />);
    expect(container.firstChild).toBeNull();
  });

  test("renders the running state with a link to Jupyter and token help toggle", async () => {
    global.fetch = mockFetch({
      running: true,
      url: "http://localhost:8888/lab",
      error: null,
    });

    render(<ExploreStatusPanel />);

    expect(
      await screen.findByText(/Explore notebook is running/i),
    ).toBeInTheDocument();

    const link = screen.getByRole("link", { name: /Open Jupyter/i });
    expect(link).toHaveAttribute("href", "http://localhost:8888/lab");
    expect(link).toHaveAttribute("target", "_blank");

    // Token help is collapsed by default.
    expect(screen.queryByText(/make explore-logs/)).toBeNull();

    // Click the toggle and the help text appears.
    fireEvent.click(
      screen.getByRole("button", { name: /How do I get the token/i }),
    );
    expect(screen.getByText(/make explore-logs/)).toBeInTheDocument();
  });

  test("renders the not-running state with a docs link", async () => {
    global.fetch = mockFetch({
      running: false,
      url: null,
      error: null,
    });

    render(<ExploreStatusPanel />);

    expect(
      await screen.findByText(/Explore notebook is not running/i),
    ).toBeInTheDocument();
    const docsLink = screen.getByRole("link", { name: /See the docs/i });
    expect(docsLink).toHaveAttribute("href", "/docs?page=16-explore");
  });

  test("renders nothing when the probe endpoint itself fails", async () => {
    global.fetch = jest.fn(() =>
      Promise.reject(new Error("network down")),
    ) as jest.Mock;

    const { container } = render(<ExploreStatusPanel />);
    // No state ever gets set — the panel just doesn't render.
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });
});
