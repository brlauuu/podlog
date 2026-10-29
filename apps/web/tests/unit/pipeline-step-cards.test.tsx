import { render, screen, fireEvent } from "@testing-library/react";
import { PipelineStepCards } from "@/components/PipelineStepCards";
import { PIPELINE_STEPS } from "@/components/PipelineSteps";
import type { Settings } from "@/components/NotificationSettingsSections";

// Radix Select/Popover are portal + pointer-event heavy in jsdom; swap them for
// lightweight equivalents so the picker logic and StepHelpContent are what's
// under test.
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
    pyannote_model: "pyannote/speaker-diarization-community-1",
    embedding_model: "all-MiniLM-L6-v2",
    rag_local_model: "",
    ...overrides,
  } as unknown as Settings;
}

// The embedding card renders EmbeddingCorpusModel (#945), which fetches the
// provenance record on mount. Unrecognised URLs are recorded and reported in
// afterEach rather than thrown from inside the mock (#895 pattern).
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

function renderCards(settings = makeSettings(), onChange = jest.fn()) {
  render(<PipelineStepCards settings={settings} hwInfo={null} onChange={onChange} />);
  return { selects: screen.getAllByTestId("model-select"), onChange };
}

describe("PipelineStepCards", () => {
  it("offers no remote switch anywhere (#1092)", () => {
    renderCards();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByText(/remote/i)).toBeNull();
  });

  it("writes the step's model field when a model is picked", () => {
    const { selects, onChange } = renderCards();

    fireEvent.change(selects[1], { target: { value: "pyannote/speaker-diarization-3.1" } });

    expect(onChange).toHaveBeenCalledWith("pyannote_model", "pyannote/speaker-diarization-3.1");
  });

  it("keeps the embedding picker usable, so a bge-small corpus can be matched (#945)", () => {
    const { selects, onChange } = renderCards();

    expect(selects[3]).not.toBeDisabled();
    fireEvent.change(selects[3], { target: { value: "BAAI/bge-small-en-v1.5" } });
    expect(onChange).toHaveBeenCalledWith("embedding_model", "BAAI/bge-small-en-v1.5");
  });

  it("disables a picker whose model is fixed in config", () => {
    const { selects } = renderCards();
    expect(selects[0]).toBeDisabled(); // transcription
    expect(selects[2]).toBeDisabled(); // speaker inference
  });

  it("renders local hardware estimates in the help content", () => {
    const hwInfo = {
      hardware: { cpu: "TestCPU", cores: 8, ram_gb: 16, gpu: null },
      profile: null,
      profile_label: null,
      estimates: { transcription_minutes_per_hour: 120, embedding_seconds_per_hour: 40 },
    };
    render(<PipelineStepCards settings={makeSettings()} hwInfo={hwInfo} onChange={jest.fn()} />);

    // Popover content is inlined by the mock, so StepHelpContent renders.
    expect(screen.getByText(/most time-consuming step/i)).toBeInTheDocument();
    expect(screen.getByText(/transcribing a\s+60-minute episode/i)).toBeInTheDocument();
    expect(screen.getByText(/embedding a\s+60-minute episode/i)).toBeInTheDocument();
  });
});

describe("PipelineStepCards — stored model outside the offered list (#1005)", () => {
  // Radix Select renders a value with no matching item as an EMPTY trigger, so
  // a model pulled in Ollama that Podlog never listed looked like "unset".

  it("keeps an unlisted model visible and says Podlog does not offer it", () => {
    renderCards(makeSettings({ rag_local_model: "gemma4:e4b" }));

    expect(screen.getByRole("option", { name: /gemma4:e4b/ })).toBeInTheDocument();
    const warning = screen.getByText(/not one of the models Podlog offers/i);
    // Must not claim it is broken: an unlisted local model often works fine.
    expect(warning.textContent).toMatch(/may still work/i);
  });

  it("says nothing when the stored model is one of the offered ones", () => {
    renderCards(makeSettings({ rag_local_model: "qwen2.5:3b" }));
    expect(screen.queryByText(/not one of the models Podlog offers/i)).toBeNull();
  });

  it("says nothing when no model is stored at all", () => {
    // getCurrentModel falls back to the first offered option.
    renderCards(makeSettings({ rag_local_model: "" }));
    expect(screen.queryByText(/not one of the models Podlog offers/i)).toBeNull();
  });
});

describe("embedding pipeline step", () => {
  const embedding = PIPELINE_STEPS.find((s) => s.key === "embedding")!;

  // Installs that embedded through Fireworks before #1092 have a bge-small
  // corpus. Running that same model locally reproduces those vectors exactly,
  // so it must stay selectable or those users cannot recover without
  // re-embedding everything.
  it("offers bge-small so an older corpus stays usable", () => {
    const values = embedding.models.map((m) => m.value);
    expect(values).toContain("BAAI/bge-small-en-v1.5");
    expect(values).toContain("all-MiniLM-L6-v2");
    expect(embedding.modelField).toBe("embedding_model");
  });
});
