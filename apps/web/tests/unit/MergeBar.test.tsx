import { render, screen, fireEvent } from "@testing-library/react";
import MergeBar from "@/components/MergeBar";

interface SpeakerInfo {
  speakerLabel: string;
  displayName: string;
  segmentCount: number;
  inferred: boolean;
  confirmedByUser: boolean;
}

const speakers: SpeakerInfo[] = [
  { speakerLabel: "SPEAKER_00", displayName: "Tim Ferriss", segmentCount: 42, inferred: false, confirmedByUser: true },
  { speakerLabel: "SPEAKER_01", displayName: "Jane Smith", segmentCount: 28, inferred: true, confirmedByUser: false },
  { speakerLabel: "SPEAKER_02", displayName: "SPEAKER_02", segmentCount: 3, inferred: false, confirmedByUser: false },
];

describe("MergeBar", () => {
  test("renders merge text with speaker count", () => {
    render(<MergeBar selectedSpeakers={speakers} onMerge={() => {}} onCancel={() => {}} merging={false} />);
    expect(screen.getByText(/merge 3 speakers into/i)).toBeInTheDocument();
  });

  test("defaults target to speaker with most segments", () => {
    render(<MergeBar selectedSpeakers={speakers} onMerge={() => {}} onCancel={() => {}} merging={false} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("SPEAKER_00");
  });

  test("calls onMerge with selected target label", () => {
    const onMerge = jest.fn();
    render(<MergeBar selectedSpeakers={speakers} onMerge={onMerge} onCancel={() => {}} merging={false} />);
    fireEvent.click(screen.getByRole("button", { name: /^merge$/i }));
    expect(onMerge).toHaveBeenCalledWith("SPEAKER_00");
  });

  test("calls onCancel when cancel clicked", () => {
    const onCancel = jest.fn();
    render(<MergeBar selectedSpeakers={speakers} onMerge={() => {}} onCancel={onCancel} merging={false} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  test("merge button disabled when merging is true", () => {
    render(<MergeBar selectedSpeakers={speakers} onMerge={() => {}} onCancel={() => {}} merging={true} />);
    expect(screen.getByRole("button", { name: /merging/i })).toBeDisabled();
  });

  test("changing dropdown updates target", () => {
    const onMerge = jest.fn();
    render(<MergeBar selectedSpeakers={speakers} onMerge={onMerge} onCancel={() => {}} merging={false} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "SPEAKER_01" } });
    fireEvent.click(screen.getByRole("button", { name: /^merge$/i }));
    expect(onMerge).toHaveBeenCalledWith("SPEAKER_01");
  });
});
