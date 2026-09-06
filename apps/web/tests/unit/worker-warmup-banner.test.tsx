/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor, act } from "@testing-library/react";
import WorkerWarmupBanner, { isWorkerWarmingUp, WARMUP_POLL_MS } from "@/components/WorkerWarmupBanner";

function health(worker: string, database = "OK") {
  return {
    status: worker === "OK" ? "OK" : "WARMING_UP",
    services: [
      { name: "Database", status: database },
      { name: "Worker", status: worker },
      { name: "Ollama", status: "OK" },
      { name: "Pipeline API", status: "OK" },
    ],
  };
}

function mockHealth(payload: unknown, ok = true) {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok, json: async () => payload } as Response),
  ) as jest.Mock;
}

const TEXT = /downloading speech models/;

describe("isWorkerWarmingUp (#1047)", () => {
  it("is true only for Database OK + Worker WARMING_UP", () => {
    expect(isWorkerWarmingUp(health("WARMING_UP"))).toBe(true);
    expect(isWorkerWarmingUp(health("OK"))).toBe(false);
    expect(isWorkerWarmingUp(health("WARMING_UP", "DEGRADED"))).toBe(false);
    expect(isWorkerWarmingUp(health("DEGRADED"))).toBe(false);
  });

  it("tolerates missing or malformed payloads", () => {
    expect(isWorkerWarmingUp(null)).toBe(false);
    expect(isWorkerWarmingUp({ status: "OK" } as never)).toBe(false);
  });
});

describe("WorkerWarmupBanner", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("shows while the worker is warming up, with the log hint", async () => {
    mockHealth(health("WARMING_UP"));
    render(<WorkerWarmupBanner />);
    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent(TEXT);
    expect(banner).toHaveTextContent("docker compose logs -f worker");
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe("/api/pipeline/health");
  });

  it("renders nothing when the worker is ready", async () => {
    mockHealth(health("OK"));
    render(<WorkerWarmupBanner />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders nothing when health cannot be reached or is not ok", async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error("down"))) as jest.Mock;
    const { unmount } = render(<WorkerWarmupBanner />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
    unmount();

    mockHealth({ error: "x" }, false);
    render(<WorkerWarmupBanner />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("disappears on its own once health flips to OK", async () => {
    jest.useFakeTimers();
    let payload = health("WARMING_UP");
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: async () => payload } as Response),
    ) as jest.Mock;
    render(<WorkerWarmupBanner />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("status")).toHaveTextContent(TEXT);

    payload = health("OK");
    await act(async () => {
      jest.advanceTimersByTime(WARMUP_POLL_MS);
      await Promise.resolve();
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);
  });
});
