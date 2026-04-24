import { render, screen, fireEvent } from "@testing-library/react";
import CoverageStrip from "@/app/meta-analysis/CoverageStrip";

describe("CoverageStrip", () => {
  it("renders podcast/episode/missing-speakers counts", () => {
    render(
      <CoverageStrip
        feedCount={5}
        episodeCount={142}
        queuedFailed={8}
        missingSpeakers={74}
        onOpenMissingSpeakers={() => {}}
        onOpenQueuedFailed={() => {}}
      />
    );
    expect(screen.getByText(/5 podcasts/)).toBeInTheDocument();
    expect(screen.getByText(/142 processed/)).toBeInTheDocument();
    expect(screen.getByText(/8 queued\/failed/)).toBeInTheDocument();
    expect(screen.getByText(/74 missing speakers/)).toBeInTheDocument();
  });

  it("fires onOpenMissingSpeakers when missing-speakers count is clicked", () => {
    const open = jest.fn();
    render(
      <CoverageStrip
        feedCount={1} episodeCount={1} queuedFailed={0} missingSpeakers={3}
        onOpenMissingSpeakers={open} onOpenQueuedFailed={() => {}}
      />
    );
    fireEvent.click(screen.getByText(/3 missing speakers/));
    expect(open).toHaveBeenCalled();
  });
});
