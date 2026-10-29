import { render, screen, waitFor } from "@testing-library/react";
import InferenceSection from "@/components/InferenceSection";
import type { Settings } from "@/components/NotificationSettingsSections";

function makeSettings(): Settings {
  return {
    pyannote_model: "pyannote/speaker-diarization-community-1",
    embedding_model: "all-MiniLM-L6-v2",
    rag_local_model: "",
  } as unknown as Settings;
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    json: async () => ({ hardware: null, estimates: null }),
  }) as unknown as typeof fetch;
});

describe("InferenceSection", () => {
  it("fetches hardware info on mount", async () => {
    render(<InferenceSection settings={makeSettings()} onChange={jest.fn()} />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/hardware"));
  });

  it("says everything runs locally and asks for no API key (#1092)", async () => {
    render(<InferenceSection settings={makeSettings()} onChange={jest.fn()} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    expect(screen.getByText(/every stage runs on this machine/i)).toBeInTheDocument();
    expect(screen.queryByText(/api key/i)).toBeNull();
    expect(screen.queryByText(/fireworks|pyannote\.ai/i)).toBeNull();
  });
});
