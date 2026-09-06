/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor, act } from "@testing-library/react";
import HealthNotices, {
  diarizationProblem,
  isWorkerWarmingUp,
  HEALTH_POLL_MS,
} from "@/components/HealthNotices";

type Svc = { name: string; status: string; detail?: string | null };

function health(worker: string, database = "OK", diarization?: Svc) {
  const services: Svc[] = [
    { name: "Database", status: database },
    { name: "Worker", status: worker },
    { name: "Ollama", status: "OK" },
    { name: "Pipeline API", status: "OK" },
  ];
  if (diarization) services.push(diarization);
  return { status: worker === "OK" ? "OK" : "WARMING_UP", services };
}

const LICENCE = {
  name: "Diarization",
  status: "DEGRADED",
  detail:
    "The licence for pyannote/speaker-diarization-community-1 has not been accepted for this token. " +
    'Open https://huggingface.co/pyannote/speaker-diarization-community-1, click "Agree and access repository", then wait a few minutes.',
};

function mockHealth(payload: unknown, ok = true) {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok, json: async () => payload } as Response),
  ) as jest.Mock;
}

const WARM = /downloading speech models/;

describe("health predicates", () => {
  it("isWorkerWarmingUp is true only for Database OK + Worker WARMING_UP", () => {
    expect(isWorkerWarmingUp(health("WARMING_UP"))).toBe(true);
    expect(isWorkerWarmingUp(health("OK"))).toBe(false);
    expect(isWorkerWarmingUp(health("WARMING_UP", "DEGRADED"))).toBe(false);
    expect(isWorkerWarmingUp(null)).toBe(false);
    expect(isWorkerWarmingUp({ status: "OK" } as never)).toBe(false);
  });

  it("diarizationProblem returns the detail only for a DEGRADED Diarization service (#1048)", () => {
    expect(diarizationProblem(health("OK", "OK", LICENCE))).toBe(LICENCE.detail);
    expect(diarizationProblem(health("OK", "OK", { name: "Diarization", status: "OK", detail: "fine" }))).toBeNull();
    expect(diarizationProblem(health("OK"))).toBeNull(); // older pipeline without the service
    expect(diarizationProblem(health("OK", "DEGRADED", LICENCE))).toBeNull();
    expect(diarizationProblem(health("OK", "OK", { name: "Diarization", status: "DEGRADED" }))).toMatch(/cannot run/);
  });
});

describe("HealthNotices", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("shows the warm-up notice with the log hint", async () => {
    mockHealth(health("WARMING_UP"));
    render(<HealthNotices />);
    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent(WARM);
    expect(banner).toHaveTextContent("docker compose logs -f worker");
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe("/api/pipeline/health");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the diarization notice with the licence link", async () => {
    mockHealth(health("OK", "OK", LICENCE));
    render(<HealthNotices />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Speaker diarization will fail until this is fixed.");
    expect(alert).toHaveTextContent("has not been accepted for this token");
    const link = screen.getByRole("link", { name: /huggingface\.co\/pyannote/ });
    expect(link).toHaveAttribute("href", "https://huggingface.co/pyannote/speaker-diarization-community-1");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows both when both apply", async () => {
    mockHealth(health("WARMING_UP", "OK", LICENCE));
    render(<HealthNotices />);
    await screen.findByRole("alert");
    expect(screen.getByRole("status")).toHaveTextContent(WARM);
  });

  it("renders nothing when everything is fine", async () => {
    mockHealth(health("OK", "OK", { name: "Diarization", status: "OK", detail: "ok" }));
    render(<HealthNotices />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders nothing when health cannot be reached or is not ok", async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error("down"))) as jest.Mock;
    const { unmount } = render(<HealthNotices />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
    unmount();

    mockHealth({ error: "x" }, false);
    render(<HealthNotices />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("clears on its own once health flips", async () => {
    jest.useFakeTimers();
    let payload: unknown = health("WARMING_UP", "OK", LICENCE);
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: async () => payload } as Response),
    ) as jest.Mock;
    render(<HealthNotices />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("status")).toHaveTextContent(WARM);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    payload = health("OK", "OK", { name: "Diarization", status: "OK", detail: "fine" });
    await act(async () => {
      jest.advanceTimersByTime(HEALTH_POLL_MS);
      await Promise.resolve();
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);
  });
});
