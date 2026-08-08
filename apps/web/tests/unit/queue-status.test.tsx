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

  test("renders empty state when no jobs", async () => {
    const empty = {
      active_count: 0, pending_count: 0, failed_count: 0,
      done_count: 0, stuck_count: 0,
      active_jobs: [], pending_jobs: [], failed_jobs: [],
      done_jobs: [], stuck_jobs: [],
    };
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: async () => empty } as Response)
    ) as jest.Mock;

    render(<QueueStatus />);
    expect(await screen.findByText(/no episodes in the queue/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /add a feed/i })).toHaveAttribute("href", "/feeds");
  });

  test("StageBar filter buttons toggle the active filter", async () => {
    const payload = {
      active_count: 1, pending_count: 0, failed_count: 1,
      done_count: 0, stuck_count: 0,
      active_jobs: [
        {
          episode_id: "ep-active", title: "Streaming",
          status: "transcribing",
          retry_count: 0, retry_max: 3, feed_mode: "full",
          feed_title: "Show A", updated_at: new Date().toISOString(),
        },
      ],
      pending_jobs: [],
      failed_jobs: [
        {
          episode_id: "ep-broken", title: "Broken One",
          status: "failed", error_class: "TRANSIENT_NETWORK",
          retry_count: 1, retry_max: 3, feed_mode: "full",
          feed_title: "Show B", updated_at: new Date().toISOString(),
        },
      ],
      done_jobs: [], stuck_jobs: [],
    };
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: async () => payload } as Response)
    ) as jest.Mock;

    render(<QueueStatus />);
    await screen.findByText("Streaming");

    // Both rows should be visible initially.
    expect(screen.getByText("Broken One")).toBeInTheDocument();

    // Click the StatusBadge on the failed row → applies stage=failed filter.
    // The row has [feed_title button, status badge button] in order.
    const failedRow = screen.getByText("Broken One").closest("tr")!;
    const buttons = failedRow.querySelectorAll("button");
    // Status badge is the last button in the row's pre-retry section
    const failedStatus = buttons[buttons.length - 1];
    fireEvent.click(failedStatus);

    // "Filtering by" indicator appears.
    await waitFor(() => {
      expect(screen.getByText(/filtering by/i)).toBeInTheDocument();
    });

    // Clear-filter button removes the indicator.
    fireEvent.click(screen.getByRole("button", { name: /clear filter/i }));
    await waitFor(() => {
      expect(screen.queryByText(/filtering by/i)).not.toBeInTheDocument();
    });
  });

  test("podcast-title click sets the search field to that title", async () => {
    const payload = {
      active_count: 1, pending_count: 0, failed_count: 0,
      done_count: 0, stuck_count: 0,
      active_jobs: [
        {
          episode_id: "ep-1", title: "Ep One", status: "transcribing",
          retry_count: 0, retry_max: 3, feed_mode: "full",
          feed_title: "Show Alpha", updated_at: new Date().toISOString(),
        },
      ],
      pending_jobs: [], failed_jobs: [], done_jobs: [], stuck_jobs: [],
    };
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: async () => payload } as Response)
    ) as jest.Mock;

    render(<QueueStatus />);
    await screen.findByText("Ep One");
    fireEvent.click(screen.getByRole("button", { name: "Show Alpha" }));
    expect((screen.getByPlaceholderText(/search episodes/i) as HTMLInputElement).value)
      .toBe("Show Alpha");
  });

  test("show/hide completed-episodes toggle reveals the done table", async () => {
    const payload = {
      active_count: 0, pending_count: 0, failed_count: 0,
      done_count: 1, stuck_count: 0,
      active_jobs: [], pending_jobs: [], failed_jobs: [],
      done_jobs: [
        {
          episode_id: "ep-done", title: "Finished Ep", status: "done",
          retry_count: 0, retry_max: 3, feed_mode: "full",
          feed_title: "Show D", updated_at: new Date().toISOString(),
        },
      ],
      stuck_jobs: [],
    };
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: async () => payload } as Response)
    ) as jest.Mock;

    render(<QueueStatus />);
    // Initially the done section is hidden ("Show 1 completed episode").
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /show 1 completed/i }))
        .toBeInTheDocument()
    );
    expect(screen.queryByText("Finished Ep")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /show 1 completed/i }));
    await waitFor(() =>
      expect(screen.getByText("Finished Ep")).toBeInTheDocument()
    );
  });
});

describe("QueueStatus — done rows and retry errors", () => {
  const now = Date.now();

  function doneJob(id: string, title: string, agoMs: number) {
    return {
      episode_id: id,
      title,
      status: "done",
      error_message: null,
      error_class: null,
      retry_count: 0,
      retry_max: 3,
      feed_mode: "full",
      feed_title: "My Podcast",
      updated_at: new Date(now - agoMs).toISOString(),
    };
  }

  test("renders completed episodes with relative times when expanded", async () => {
    const payload = {
      active_count: 0, pending_count: 0, failed_count: 0, done_count: 3, stuck_count: 0,
      active_jobs: [], pending_jobs: [], failed_jobs: [],
      done_jobs: [
        doneJob("d1", "Minutes Ago", 5 * 60 * 1000),
        doneJob("d2", "Hours Ago", 2 * 60 * 60 * 1000),
        doneJob("d3", "Days Ago", 3 * 24 * 60 * 60 * 1000),
      ],
      stuck_jobs: [],
    };
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: async () => payload } as Response)
    ) as jest.Mock;

    render(<QueueStatus />);

    const toggle = await screen.findByRole("button", { name: /completed episode/i });
    fireEvent.click(toggle);

    expect(await screen.findByText("Minutes Ago")).toBeInTheDocument();
    expect(screen.getByText("Hours Ago")).toBeInTheDocument();
    expect(screen.getByText("Days Ago")).toBeInTheDocument();
    expect(screen.getByText("5m ago")).toBeInTheDocument();
    expect(screen.getByText("2h ago")).toBeInTheDocument();
    expect(screen.getByText("3d ago")).toBeInTheDocument();
  });

  function failedPayload() {
    return {
      active_count: 0, pending_count: 0, failed_count: 1, done_count: 0, stuck_count: 0,
      active_jobs: [], pending_jobs: [],
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
          updated_at: new Date(now).toISOString(),
        },
      ],
      done_jobs: [], stuck_jobs: [],
    };
  }

  async function clickRetry() {
    render(<QueueStatus />);
    const title = await screen.findByText("Broken Episode");
    fireEvent.click(title.closest("tr")!);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
  }

  test("logs an error when the retry response is not ok", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = jest.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url === "/api/queue") return Promise.resolve({ ok: true, json: async () => failedPayload() } as Response);
      return Promise.resolve({ ok: false, status: 500 } as Response);
    }) as jest.Mock;

    await clickRetry();

    await waitFor(() =>
      expect(errSpy).toHaveBeenCalledWith("Retry failed with status", 500)
    );
    errSpy.mockRestore();
  });

  test("logs an error when the retry request throws", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = jest.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url === "/api/queue") return Promise.resolve({ ok: true, json: async () => failedPayload() } as Response);
      return Promise.reject(new Error("offline"));
    }) as jest.Mock;

    await clickRetry();

    await waitFor(() =>
      expect(errSpy).toHaveBeenCalledWith("Retry request failed", expect.any(Error))
    );
    errSpy.mockRestore();
  });
});
