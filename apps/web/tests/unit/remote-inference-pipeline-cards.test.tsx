import { render, screen, fireEvent } from "@testing-library/react";
import { PipelineStepCards } from "@/components/RemoteInferencePipelineCards";
import type { Settings } from "@/components/NotificationSettingsSections";

// Radix Select/Popover are portal + pointer-event heavy in jsdom; swap them for
// lightweight equivalents so the handler logic (handleToggle / handleModelChange
// / StepHelpContent) is what's under test. The real Switch works via click.
jest.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, disabled, children }: any) => (
    <select
      data-testid="model-select"
      value={value}
      disabled={disabled}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

jest.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => <div>{children}</div>,
  PopoverTrigger: ({ children }: any) => <div>{children}</div>,
  PopoverContent: ({ children }: any) => <div>{children}</div>,
}));

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

// The embedding card renders EmbeddingCorpusModel (#945), which fetches the
// provenance record on mount. jsdom has no fetch, so without this the cards
// throw on render. Unrecognised URLs are recorded and reported in afterEach
// rather than thrown from inside the mock, following the #895 pattern —
// throwing here would be swallowed by the component's own catch and surface
// as a silent "unavailable" instead of naming the missing URL.
const unmockedUrls: string[] = [];

beforeEach(() => {
  unmockedUrls.length = 0;
  global.fetch = jest.fn((url: string) => {
    if (url === "/api/pipeline/embed-model-state") {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          recorded_model: "all-MiniLM-L6-v2",
          configured_model: "all-MiniLM-L6-v2",
          matches: true,
          embedded_segments: 100,
        }),
      });
    }
    unmockedUrls.push(url);
    return Promise.resolve({ ok: false, json: async () => ({}) });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  if (unmockedUrls.length > 0) {
    throw new Error(`fetch mock did not recognise: ${unmockedUrls.join(", ")}`);
  }
});

// Step render order: [transcription, diarization, speaker-inference, embedding, rag]

describe("PipelineStepCards — handleToggle", () => {
  it("prompts for the API key when enabling remote without a key", () => {
    const onChange = jest.fn();
    const onRequireApiKey = jest.fn();
    render(
      <PipelineStepCards
        settings={makeSettings()}
        hwInfo={null}
        onChange={onChange}
        onRequireApiKey={onRequireApiKey}
      />
    );

    fireEvent.click(screen.getAllByRole("switch")[0]); // transcription

    expect(onRequireApiKey).toHaveBeenCalledWith("Fireworks API key");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("switches a step to remote when the API key is present", () => {
    const onChange = jest.fn();
    render(
      <PipelineStepCards
        settings={makeSettings({ fireworks_api_key: "fw_x" })}
        hwInfo={null}
        onChange={onChange}
        onRequireApiKey={jest.fn()}
      />
    );

    fireEvent.click(screen.getAllByRole("switch")[0]);

    expect(onChange).toHaveBeenCalledWith("inference_provider", "fireworks");
  });

  it("switches a remote step back to local", () => {
    const onChange = jest.fn();
    render(
      <PipelineStepCards
        settings={makeSettings({ inference_provider: "fireworks", fireworks_api_key: "fw_x" })}
        hwInfo={null}
        onChange={onChange}
        onRequireApiKey={jest.fn()}
      />
    );

    fireEvent.click(screen.getAllByRole("switch")[0]);

    expect(onChange).toHaveBeenCalledWith("inference_provider", "local");
  });
});

describe("PipelineStepCards — handleModelChange", () => {
  it("writes the local model field for a local step", () => {
    const onChange = jest.fn();
    render(
      <PipelineStepCards
        settings={makeSettings()}
        hwInfo={null}
        onChange={onChange}
        onRequireApiKey={jest.fn()}
      />
    );

    // diarization (index 1) is local and has two local models.
    fireEvent.change(screen.getAllByTestId("model-select")[1], {
      target: { value: "pyannote/speaker-diarization-3.1" },
    });

    expect(onChange).toHaveBeenCalledWith("pyannote_model", "pyannote/speaker-diarization-3.1");
  });

  it("writes the remote model field for a remote step", () => {
    const onChange = jest.fn();
    render(
      <PipelineStepCards
        settings={makeSettings({ rag_provider: "fireworks", fireworks_api_key: "fw_x" })}
        hwInfo={null}
        onChange={onChange}
        onRequireApiKey={jest.fn()}
      />
    );

    // rag (index 4) is remote; pick a real second option from the rendered list.
    const ragSelect = screen.getAllByTestId("model-select")[4];
    const options = ragSelect.querySelectorAll("option");
    const target = (options[1] ?? options[0]).getAttribute("value") as string;
    fireEvent.change(ragSelect, { target: { value: target } });

    expect(onChange).toHaveBeenCalledWith("fireworks_chat_model", target);
  });
});

describe("PipelineStepCards — StepHelpContent", () => {
  it("renders per-step help content with hardware estimates", () => {
    const hwInfo = {
      hardware: { cpu: "TestCPU", ram_gb: 16, gpu: null },
      estimates: {
        transcription_minutes_per_hour: 120,
        remote_transcription_minutes_per_hour: 5,
        remote_cost_per_hour_usd: 0.3,
        embedding_seconds_per_hour: 40,
        remote_embedding_seconds_per_hour: 2,
      },
    } as never;

    render(
      <PipelineStepCards
        settings={makeSettings()}
        hwInfo={hwInfo}
        onChange={jest.fn()}
        onRequireApiKey={jest.fn()}
      />
    );

    // Popover content is inlined by the mock, so StepHelpContent renders.
    expect(screen.getByText(/most time-consuming step/i)).toBeInTheDocument();
    expect(screen.getByText(/transcribing a\s+60-minute episode/i)).toBeInTheDocument();
  });
});
