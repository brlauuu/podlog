import { render, screen, fireEvent } from "@testing-library/react";
import CoverageStrip from "@/app/meta-analysis/CoverageStrip";

jest.mock("next/link", () => {
  const Link = ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  );
  Link.displayName = "Link";
  return { __esModule: true, default: Link };
});

describe("CoverageStrip", () => {
  it("renders podcast/episode/missing-speakers counts", () => {
    render(
      <CoverageStrip
        feedCount={5}
        episodeCount={142}
        queuedFailed={8}
        missingSpeakers={74}
        onOpenMissingSpeakers={() => {}}
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
        onOpenMissingSpeakers={open}
      />
    );
    fireEvent.click(screen.getByText(/3 missing speakers/));
    expect(open).toHaveBeenCalled();
  });

  describe("queued/failed segment (#970)", () => {
    // It used to be a <button> wired to an empty handler with the count
    // hardcoded to 0, styled identically to the working drill-down next to it.
    it("links to the queue rather than being an inert button", () => {
      render(
        <CoverageStrip
          feedCount={1} episodeCount={10} queuedFailed={4} missingSpeakers={0}
          onOpenMissingSpeakers={() => {}}
        />
      );
      const link = screen.getByRole("link", { name: /4 queued\/failed/ });
      expect(link).toHaveAttribute("href", "/queue");
    });

    it("is hidden when nothing is outstanding, rather than showing a dead 0", () => {
      render(
        <CoverageStrip
          feedCount={1} episodeCount={10} queuedFailed={0} missingSpeakers={0}
          onOpenMissingSpeakers={() => {}}
        />
      );
      expect(screen.queryByText(/queued\/failed/)).toBeNull();
    });

    it("is hidden when the queue could not be reached", () => {
      // null means "unknown". Rendering 0 there would assert everything is
      // processed, which is exactly the false reassurance #970 was about.
      render(
        <CoverageStrip
          feedCount={1} episodeCount={10} queuedFailed={null} missingSpeakers={2}
          onOpenMissingSpeakers={() => {}}
        />
      );
      expect(screen.queryByText(/queued\/failed/)).toBeNull();
      expect(screen.getByText(/2 missing speakers/)).toBeInTheDocument();
    });
  });
});
