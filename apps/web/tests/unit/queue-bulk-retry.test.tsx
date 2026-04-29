/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import QueueStatus from "@/components/QueueStatus";

jest.mock("next/link", () => {
  return ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  );
});

const emptyQueue = {
  active_count: 0,
  pending_count: 0,
  failed_count: 0,
  done_count: 0,
  stuck_count: 0,
  active_jobs: [],
  pending_jobs: [],
  failed_jobs: [],
  done_jobs: [],
  stuck_jobs: [],
};

function makeFetchMock(handlers: Record<string, (init?: RequestInit) => Promise<Response>>) {
  return jest.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const handler = handlers[url];
    if (handler) return handler(init);
    return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
  }) as jest.Mock;
}

describe("QueueStatus bulk-retry (#610 PR 5)", () => {
  test("hides the bulk-retry banner when no eligible episodes", async () => {
    global.fetch = makeFetchMock({
      "/api/queue": () => Promise.resolve({ ok: true, json: async () => emptyQueue } as Response),
      "/api/pipeline/queue/bulk-retry/upload-rejected": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            eligible_count: 0,
            total_minutes: 0,
            estimated_cost_usd: 0,
            chunked_enabled: true,
          }),
        } as Response),
    });

    render(<QueueStatus />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByText(/upload/i)).toBeNull();
  });

  test("shows banner with disabled button when chunked is off", async () => {
    global.fetch = makeFetchMock({
      "/api/queue": () => Promise.resolve({ ok: true, json: async () => emptyQueue } as Response),
      "/api/pipeline/queue/bulk-retry/upload-rejected": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            eligible_count: 12,
            total_minutes: 1440,
            estimated_cost_usd: 8.64,
            chunked_enabled: false,
          }),
        } as Response),
    });

    render(<QueueStatus />);

    expect(
      await screen.findByText(/12 episodes failed because Fireworks rejected the upload/i),
    ).toBeInTheDocument();
    const retryBtn = screen.getByRole("button", { name: /retry with chunking/i });
    expect(retryBtn).toBeDisabled();
    // Helpful hint about enabling the toggle.
    expect(screen.getByText(/Chunk long episodes/i)).toBeInTheDocument();
  });

  test("opens confirm dialog and POSTs on confirm when chunked is on", async () => {
    let postCalled = false;
    global.fetch = makeFetchMock({
      "/api/queue": () => Promise.resolve({ ok: true, json: async () => emptyQueue } as Response),
      "/api/pipeline/queue/bulk-retry/upload-rejected": (init) => {
        if (init?.method === "POST") {
          postCalled = true;
          return Promise.resolve({
            ok: true,
            json: async () => ({ queued: 5, episode_ids: ["a", "b", "c", "d", "e"] }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            eligible_count: 5,
            total_minutes: 600,
            estimated_cost_usd: 3.6,
            chunked_enabled: true,
          }),
        } as Response);
      },
    });

    render(<QueueStatus />);

    const retryBtn = await screen.findByRole("button", { name: /retry with chunking/i });
    expect(retryBtn).not.toBeDisabled();
    fireEvent.click(retryBtn);

    // Confirm dialog appears.
    expect(await screen.findByText(/Confirm bulk retry/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Confirm$/i }));

    await waitFor(() => expect(postCalled).toBe(true));
  });

  test("shows error message when POST returns 422", async () => {
    global.fetch = makeFetchMock({
      "/api/queue": () => Promise.resolve({ ok: true, json: async () => emptyQueue } as Response),
      "/api/pipeline/queue/bulk-retry/upload-rejected": (init) => {
        if (init?.method === "POST") {
          return Promise.resolve({
            ok: false,
            status: 422,
            json: async () => ({ detail: "Chunked transcription is disabled." }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            eligible_count: 1,
            total_minutes: 60,
            estimated_cost_usd: 0.36,
            chunked_enabled: true,
          }),
        } as Response);
      },
    });

    render(<QueueStatus />);

    fireEvent.click(await screen.findByRole("button", { name: /retry with chunking/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Confirm$/i }));

    expect(
      await screen.findByText(/Chunked transcription is disabled/i),
    ).toBeInTheDocument();
  });
});
