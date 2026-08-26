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
    pyannote_cloud_cost_per_second_usd: 0,
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

  it("wires the pyannote rate field to onChange as a number (#969)", async () => {
    // The defect this guards: pyannote_cloud_cost_per_second_usd was in the
    // settings schema and in the Inference tab's dirty-field set, and the
    // server validated it -- but no component rendered a control, so the
    // only way to set it was .env or a direct DB write, while the episode
    // cost chip told users to set it "in Settings".
    const onChange = jest.fn();
    render(<RemoteInferenceSection settings={makeSettings()} onChange={onChange} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/pyannote cloud rate/i), {
      target: { value: "0.0035" },
    });

    expect(onChange).toHaveBeenCalledWith(
      "pyannote_cloud_cost_per_second_usd",
      0.0035
    );
  });

  it("renders a control for every pyannote setting the Inference tab saves (#969)", async () => {
    // NotificationSettings routes these keys to the Inference tab's Save
    // button. A key that is saveable but not editable is the bug above.
    render(
      <RemoteInferenceSection settings={makeSettings()} onChange={jest.fn()} />
    );
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    expect(screen.getByPlaceholderText("Your pyannote.ai API key")).toBeInTheDocument();
    expect(screen.getByLabelText(/pyannote cloud rate/i)).toBeInTheDocument();
  });

  it("opens the API-key-required dialog when enabling remote without a key", async () => {
    render(<RemoteInferenceSection settings={makeSettings()} onChange={jest.fn()} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    // Transcription switch with no Fireworks key → onRequireApiKey → dialog.
    fireEvent.click(screen.getAllByRole("switch")[0]);

    expect(await screen.findByText("API key required")).toBeInTheDocument();
  });
});
