import { render, screen, waitFor } from "@testing-library/react";
import { EmbeddingCorpusModel } from "@/components/EmbeddingCorpusModel";

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  mockFetch.mockReset();
});

function respond(body: Record<string, unknown>, ok = true) {
  mockFetch.mockResolvedValue({ ok, json: async () => body });
}

describe("EmbeddingCorpusModel (#945)", () => {
  it("names the model that built the corpus and the segment count", async () => {
    respond({
      recorded_model: "BAAI/bge-small-en-v1.5",
      configured_model: "BAAI/bge-small-en-v1.5",
      matches: true,
      embedded_segments: 873778,
    });

    render(<EmbeddingCorpusModel />);

    expect(await screen.findByText(/BAAI\/bge-small-en-v1\.5/)).toBeInTheDocument();
    expect(screen.getByText(/873,778 segments/)).toBeInTheDocument();
  });

  // The whole point of surfacing this: make the consequence visible at the
  // moment of choosing, since no other guard notices a same-dimension swap.
  it("warns loudly when the configured model differs from the corpus", async () => {
    respond({
      recorded_model: "BAAI/bge-small-en-v1.5",
      configured_model: "all-MiniLM-L6-v2",
      matches: false,
      embedded_segments: 100,
    });

    render(<EmbeddingCorpusModel />);

    expect(await screen.findByText(/Embedding is\s+blocked/)).toBeInTheDocument();
    expect(screen.getByText(/all-MiniLM-L6-v2/)).toBeInTheDocument();
  });

  it("says nothing is recorded yet on a fresh install", async () => {
    respond({
      recorded_model: null,
      configured_model: "all-MiniLM-L6-v2",
      matches: true,
      embedded_segments: 0,
    });

    render(<EmbeddingCorpusModel />);

    expect(await screen.findByText(/No embeddings recorded yet/)).toBeInTheDocument();
  });

  it("renders nothing when the pipeline is unreachable", async () => {
    // Supplementary context only — Settings must stay usable with the
    // pipeline down.
    mockFetch.mockRejectedValue(new Error("network"));

    const { container } = render(<EmbeddingCorpusModel />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing on a non-ok response", async () => {
    respond({ error: "Unavailable" }, false);

    const { container } = render(<EmbeddingCorpusModel />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
