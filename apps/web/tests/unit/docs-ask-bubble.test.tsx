/**
 * #990: the docs Ask bubble.
 *
 * Two things follow existing house patterns rather than being invented here:
 *
 * - The fake `getReader` response shape, from episode-chat-streaming.test.tsx.
 *   jsdom has no `Response`, and a real one cannot be streamed anyway.
 * - Unrecognised URLs are recorded and asserted in afterEach, not thrown.
 *   The component wraps its fetch in try/catch, so a throw inside the mock
 *   surfaces as a generic "Connection failed" and hides the real cause (#895).
 *
 * Note the token frames use `{"content": ...}` -- the shape the pipeline
 * actually emits (app/api/ask.py::_stream_ask). A fixture using `text` would
 * pass against a component reading the wrong field and fail against the real
 * stream.
 *
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

import DocsAskBubble from "@/components/DocsAskBubble";

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

let unmockedUrls: string[] = [];

function streamResponse(sse: string) {
  const chunks = [new TextEncoder().encode(sse)];
  let i = 0;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length
            ? { done: false, value: chunks[i++] }
            : { done: true, value: undefined },
      }),
    },
  };
}

/** Queue one SSE stream per call, in order. */
function mockAsk(...streams: string[]) {
  let n = 0;
  mockFetch.mockImplementation((url: string) => {
    if (url === "/api/docs/ask") {
      const sse = streams[Math.min(n, streams.length - 1)];
      n += 1;
      return Promise.resolve(streamResponse(sse));
    }
    unmockedUrls.push(url);
    return Promise.resolve({ ok: false, status: 404 });
  });
}

function send(question: string) {
  fireEvent.change(screen.getByPlaceholderText(/ask a question/i), {
    target: { value: question },
  });
  fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
}

function openAndAsk(question: string) {
  fireEvent.click(screen.getByRole("button", { name: /ask about the docs/i }));
  send(question);
}

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

beforeEach(() => {
  unmockedUrls = [];
  mockFetch.mockReset();
});

afterEach(() => {
  expect(unmockedUrls).toEqual([]);
});

describe("DocsAskBubble (#990)", () => {
  it("is collapsed until opened", () => {
    render(<DocsAskBubble />);
    expect(screen.getByRole("button", { name: /ask about the docs/i })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/ask a question/i)).toBeNull();
  });

  it("streams an answer and shows it", async () => {
    mockAsk(
      `event: token\ndata: {"content":"Whisper "}\n\n` +
      `event: token\ndata: {"content":"is unloaded."}\n\n` +
      `event: done\ndata: {}\n\n`,
    );

    render(<DocsAskBubble />);
    openAndAsk("why is Whisper unloaded?");

    await waitFor(() =>
      expect(screen.getByText(/Whisper is unloaded\./)).toBeInTheDocument(),
    );
  });

  it("sends the question to the docs endpoint, not the transcript one", async () => {
    mockAsk(`event: done\ndata: {}\n\n`);

    render(<DocsAskBubble />);
    openAndAsk("how do I add a feed?");

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/docs/ask");
    expect(JSON.parse(init.body as string).question).toBe("how do I add a feed?");
  });

  it("does not pin a model, so Settings decides the provider and model", async () => {
    // The pipeline resolves: rag_provider picks local vs Fireworks, then
    // rag_local_model / fireworks_chat_model picks the model. Sending a
    // model here wins over `model or runtime.get("rag_local_model")` in
    // api/ask.py, silently ignoring the operator's configured local model.
    mockAsk(`event: done\ndata: {}\n\n`);

    render(<DocsAskBubble />);
    openAndAsk("anything");

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(init.body as string);
    expect(sent.model).toBeUndefined();
  });

  it("deep-links a guide citation to its heading", async () => {
    mockAsk(
      `event: sources\ndata: [{"title":"A note on memory","source":"guide","slug":"19-inference-providers","anchor":"a-note-on-memory","repo_path":"docs/guide/19-inference-providers.md","text":"..."}]\n\n` +
      `event: done\ndata: {}\n\n`,
    );

    render(<DocsAskBubble />);
    openAndAsk("memory");

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /A note on memory/ })).toHaveAttribute(
        "href",
        "/docs?page=19-inference-providers#a-note-on-memory",
      );
    });
  });

  it("links a PRD citation to the repository, since PRDs are not rendered", async () => {
    mockAsk(
      `event: sources\ndata: [{"title":"Memory","source":"prd","slug":"PRD-01-ingestion-pipeline","anchor":null,"repo_path":"prds/PRD-01-ingestion-pipeline.md","text":"..."}]\n\n` +
      `event: done\ndata: {}\n\n`,
    );

    render(<DocsAskBubble />);
    openAndAsk("memory");

    await waitFor(() => {
      const link = screen.getByRole("link", { name: /Memory/ });
      expect(link).toHaveAttribute(
        "href",
        "https://github.com/brlauuu/podlog/blob/main/prds/PRD-01-ingestion-pipeline.md",
      );
      expect(link).toHaveAttribute("target", "_blank");
    });
  });

  it("shows the error text when the stream reports one", async () => {
    mockAsk(
      `event: error\ndata: {"message":"No documentation matched your question."}\n\n` +
      `event: done\ndata: {}\n\n`,
    );

    render(<DocsAskBubble />);
    openAndAsk("zzzz");

    await waitFor(() =>
      expect(screen.getByText(/No documentation matched/)).toBeInTheDocument(),
    );
  });

  it("keeps each answer's citations with that answer across turns", async () => {
    // A single panel-level `sources` list would move the first answer's
    // citations onto the second, silently misattributing them.
    mockAsk(
      `event: sources\ndata: [{"title":"First Source","source":"guide","slug":"03-feeds","anchor":"adding","repo_path":"docs/guide/03-feeds.md","text":"..."}]\n\n` +
      `event: token\ndata: {"content":"one"}\n\n` +
      `event: done\ndata: {}\n\n`,
      `event: sources\ndata: [{"title":"Second Source","source":"guide","slug":"04-search","anchor":"basics","repo_path":"docs/guide/04-search.md","text":"..."}]\n\n` +
      `event: token\ndata: {"content":"two"}\n\n` +
      `event: done\ndata: {}\n\n`,
    );

    render(<DocsAskBubble />);
    openAndAsk("first question");
    await waitFor(() => expect(screen.getByText("one")).toBeInTheDocument());

    send("second question");
    await waitFor(() => expect(screen.getByText("two")).toBeInTheDocument());

    expect(screen.getByRole("link", { name: /First Source/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Second Source/ })).toBeInTheDocument();
  });

  it("reports a failed connection rather than sitting silent", async () => {
    mockFetch.mockImplementation(() => Promise.resolve({ ok: false, status: 502 }));

    render(<DocsAskBubble />);
    openAndAsk("anything");

    await waitFor(() =>
      expect(screen.getByText(/Failed to reach the documentation service/)).toBeInTheDocument(),
    );
  });
});
