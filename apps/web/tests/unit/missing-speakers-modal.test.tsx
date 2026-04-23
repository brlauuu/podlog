import { render, screen, fireEvent } from "@testing-library/react";
import MissingSpeakersModal from "@/app/meta-analysis/MissingSpeakersModal";
import type { MissingSpeakersResponse } from "@/lib/metaAnalysisTypes";

const SAMPLE: MissingSpeakersResponse = {
  podcasts: [
    {
      feed_id: "f1",
      title: "Podcast One",
      episodes: [
        { id: "e1", title: "Episode 1", reason: "no_segments" },
        { id: "e2", title: "Episode 2", reason: "low_confidence" },
      ],
    },
    {
      feed_id: "f2",
      title: "Podcast Two",
      episodes: [{ id: "e3", title: "Solo episode", reason: "no_speakers" }],
    },
  ],
};

describe("MissingSpeakersModal", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <MissingSpeakersModal open={false} onClose={() => {}} data={SAMPLE} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders empty-state copy when data is null", () => {
    render(<MissingSpeakersModal open onClose={() => {}} data={null} />);
    expect(screen.getByText(/No excluded episodes/i)).toBeInTheDocument();
  });

  it("renders empty-state copy when data.podcasts is empty", () => {
    render(<MissingSpeakersModal open onClose={() => {}} data={{ podcasts: [] }} />);
    expect(screen.getByText(/No excluded episodes/i)).toBeInTheDocument();
  });

  it("renders podcast titles and episode links with hrefs", () => {
    render(<MissingSpeakersModal open onClose={() => {}} data={SAMPLE} />);
    expect(screen.getByText("Podcast One")).toBeInTheDocument();
    expect(screen.getByText("Podcast Two")).toBeInTheDocument();
    expect(screen.getByText("Episode 1").closest("a")).toHaveAttribute("href", "/episodes/e1");
    expect(screen.getByText("Solo episode").closest("a")).toHaveAttribute("href", "/episodes/e3");
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = jest.fn();
    render(<MissingSpeakersModal open onClose={onClose} data={SAMPLE} />);
    fireEvent.click(screen.getByLabelText("Close dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = jest.fn();
    render(<MissingSpeakersModal open onClose={onClose} data={SAMPLE} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when backdrop is clicked", () => {
    const onClose = jest.fn();
    const { container } = render(
      <MissingSpeakersModal open onClose={onClose} data={SAMPLE} />
    );
    // The first child is the backdrop fixed div.
    fireEvent.click(container.firstChild as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when inner panel is clicked", () => {
    const onClose = jest.fn();
    render(<MissingSpeakersModal open onClose={onClose} data={SAMPLE} />);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
