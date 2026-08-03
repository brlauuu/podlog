import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import RemoteInferenceSection from "@/components/RemoteInferenceSection";
import type { Settings } from "@/components/NotificationSettingsSections";

function makeSettings(overrides: Record<string, unknown> = {}): Settings {
  return {
    inference_provider: "local",
    diarization_provider: "local",
    embedding_provider: "local",
    rag_provider: "local",
    fireworks_api_key: null,
    pyannote_api_key: null,
    pyannote_model: "pyannote/speaker-diarization-community-1",
    embedding_model: "all-MiniLM-L6-v2",
    rag_local_model: "",
    fireworks_stt_model: "",
    fireworks_chat_model: "",
    fireworks_stt_cost_per_minute_usd: 0.005,
    ...overrides,
  } as unknown as Settings;
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    json: async () => ({ hardware: null, estimates: null }),
  }) as unknown as typeof fetch;
});

describe("RemoteInferenceSection", () => {
  it("fetches hardware info on mount", async () => {
    render(<RemoteInferenceSection settings={makeSettings()} onChange={jest.fn()} />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/hardware"));
  });

  it("wires the Fireworks and pyannote key fields to onChange", async () => {
    const onChange = jest.fn();
    render(<RemoteInferenceSection settings={makeSettings()} onChange={onChange} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    fireEvent.change(screen.getByPlaceholderText("fw_..."), {
      target: { value: "fw_key" },
    });
    expect(onChange).toHaveBeenCalledWith("fireworks_api_key", "fw_key");

    fireEvent.change(screen.getByPlaceholderText("Your pyannote.ai API key"), {
      target: { value: "pk_key" },
    });
    expect(onChange).toHaveBeenCalledWith("pyannote_api_key", "pk_key");
  });

  it("opens the API-key-required dialog when enabling remote without a key", async () => {
    render(<RemoteInferenceSection settings={makeSettings()} onChange={jest.fn()} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    // Transcription switch with no Fireworks key → onRequireApiKey → dialog.
    fireEvent.click(screen.getAllByRole("switch")[0]);

    expect(await screen.findByText("API key required")).toBeInTheDocument();
  });
});
