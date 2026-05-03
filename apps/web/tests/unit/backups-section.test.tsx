/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import BackupsSection from "@/components/BackupsSection";

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  mockFetch.mockReset();
});

function jsonResponse(body: unknown) {
  return Promise.resolve({
    ok: true,
    json: async () => body,
  } as Response);
}

describe("<BackupsSection>", () => {
  it("renders DB tiers grouped by daily / weekly / monthly with retention counts", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        enabled: true,
        mounted: true,
        retention: { daily: 7, weekly: 4, monthly: 12 },
        last_run: "2026-05-03",
        db: {
          daily: [
            { date: "2026-05-03", filename: "podlog-2026-05-03.dump", size_bytes: 1024 },
            { date: "2026-05-02", filename: "podlog-2026-05-02.dump", size_bytes: 2048 },
          ],
          weekly: [
            { date: "2026-04-26", filename: "podlog-2026-04-26.dump", size_bytes: 4096 },
          ],
          monthly: [],
        },
        audio: [{ date: "2026-05-03", size_bytes: 1048576 }],
      }),
    );

    render(<BackupsSection />);

    await waitFor(() =>
      expect(screen.getByText(/Daily — 2 of 7 kept/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Weekly — 1 of 4 kept/)).toBeInTheDocument();
    expect(screen.getByText(/Monthly — 0 of 12 kept/)).toBeInTheDocument();
    // Date appears in multiple sections (DB daily + audio + last_run); just
    // confirm at least one rendered occurrence.
    expect(screen.getAllByText("2026-05-03").length).toBeGreaterThan(0);
    // "Last run:" sits in a <p> that has a nested <span> for the date, so the
    // visible text spans nodes — match against the parent paragraph text.
    expect(
      screen.getByText((_text, el) =>
        Boolean(el?.textContent?.match(/^Last run:\s*2026-05-03$/)),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Audio snapshots/)).toBeInTheDocument();
  });

  it("shows the mount-missing message when the pipeline can't see /backups", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        enabled: false,
        mounted: false,
        retention: { daily: 7, weekly: 4, monthly: 12 },
        last_run: null,
        db: { daily: [], weekly: [], monthly: [] },
        audio: [],
      }),
    );

    render(<BackupsSection />);

    await waitFor(() =>
      expect(
        screen.getByText(/backups directory isn't reachable/i),
      ).toBeInTheDocument(),
    );
  });

  it("shows the disabled-retention message when all retention values are 0", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        enabled: false,
        mounted: true,
        retention: { daily: 0, weekly: 0, monthly: 0 },
        last_run: null,
        db: { daily: [], weekly: [], monthly: [] },
        audio: [],
      }),
    );

    render(<BackupsSection />);

    await waitFor(() =>
      expect(
        screen.getByText(/daily backup loop is effectively disabled/i),
      ).toBeInTheDocument(),
    );
  });

  it("renders an empty-state line per tier when the tier has no dumps yet", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        enabled: true,
        mounted: true,
        retention: { daily: 7, weekly: 4, monthly: 12 },
        last_run: null,
        db: { daily: [], weekly: [], monthly: [] },
        audio: [],
      }),
    );

    render(<BackupsSection />);

    await waitFor(() =>
      expect(screen.getByText(/Daily — 0 of 7 kept/)).toBeInTheDocument(),
    );
    expect(screen.getAllByText("No backups yet.")).toHaveLength(3);
    expect(screen.getByText("No audio snapshots yet.")).toBeInTheDocument();
  });
});
