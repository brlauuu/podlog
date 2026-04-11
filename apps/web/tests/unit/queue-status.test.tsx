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

describe("QueueStatus", () => {
  test("renders failed episode and retries via API", async () => {
    const queuePayload = {
      active_count: 0,
      pending_count: 0,
      failed_count: 1,
      done_count: 0,
      stuck_count: 0,
      active_jobs: [],
      pending_jobs: [],
      failed_jobs: [
        {
          episode_id: "ep-failed",
          title: "Broken Episode",
          status: "failed",
          error_message: "network timeout",
          error_class: "TRANSIENT_NETWORK",
          retry_count: 1,
          retry_max: 3,
          feed_mode: "full",
          feed_title: "My Podcast",
          updated_at: new Date().toISOString(),
        },
      ],
      done_jobs: [],
      stuck_jobs: [],
    };

    global.fetch = jest.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/queue") {
        return Promise.resolve({
          ok: true,
          json: async () => queuePayload,
        } as Response);
      }
      if (url === "/api/pipeline/queue/ep-failed/retry") {
        expect(init?.method).toBe("POST");
        return Promise.resolve({ ok: true } as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    }) as jest.Mock;

    render(<QueueStatus />);

    const episodeTitle = await screen.findByText("Broken Episode");
    expect(episodeTitle).toBeInTheDocument();
    const failedRow = episodeTitle.closest("tr");
    expect(failedRow).not.toBeNull();
    fireEvent.click(failedRow!);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/pipeline/queue/ep-failed/retry",
        { method: "POST" }
      );
    });
  });
});
