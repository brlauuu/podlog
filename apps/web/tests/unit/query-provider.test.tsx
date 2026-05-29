/**
 * @jest-environment jsdom
 *
 * Tests for the QueryClientProvider wrapper mounted at the layout root.
 * Verifies that the provider mounts its children and that descendant
 * components can read the QueryClient via useQueryClient.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useQueryClient, useQuery } from "@tanstack/react-query";

import QueryProvider from "@/components/QueryProvider";

function ClientProbe() {
  const c = useQueryClient();
  const opts = c.getDefaultOptions().queries;
  return (
    <>
      <span data-testid="has-client">{c ? "yes" : "no"}</span>
      <span data-testid="stale-time">{String(opts?.staleTime ?? "")}</span>
      <span data-testid="retry">{String(opts?.retry ?? "")}</span>
    </>
  );
}

function QueryProbe() {
  const q = useQuery({ queryKey: ["k"], queryFn: () => "hello" });
  return <span data-testid="data">{q.data ?? "(loading)"}</span>;
}

describe("<QueryProvider>", () => {
  it("renders its children", () => {
    render(
      <QueryProvider>
        <p data-testid="child">hi</p>
      </QueryProvider>,
    );
    expect(screen.getByTestId("child")).toHaveTextContent("hi");
  });

  it("exposes a QueryClient to descendants with the expected defaults", () => {
    render(
      <QueryProvider>
        <ClientProbe />
      </QueryProvider>,
    );
    expect(screen.getByTestId("has-client")).toHaveTextContent("yes");
    expect(screen.getByTestId("stale-time")).toHaveTextContent("30000");
    expect(screen.getByTestId("retry")).toHaveTextContent("1");
  });

  it("lets descendants run a query and read its data", async () => {
    render(
      <QueryProvider>
        <QueryProbe />
      </QueryProvider>,
    );
    expect(
      await screen.findByText("hello", undefined, { timeout: 2000 }),
    ).toBeInTheDocument();
  });
});
