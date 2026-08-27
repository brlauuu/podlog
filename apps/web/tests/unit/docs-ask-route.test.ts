/** @jest-environment node */
/**
 * #990: the /api/docs/ask route joins the two halves of the docs Ask
 * feature -- retrieval here (the only container with the docs mounted),
 * generation in the pipeline.
 */
import { POST } from "@/app/api/docs/ask/route";

jest.mock("@/lib/docs-index", () => ({
  buildDocsCorpusIndex: jest.fn(async () => [
    {
      docSlug: "19-inference-providers", docTitle: "Inference Providers",
      sectionId: "a-note-on-memory", sectionTitle: "A note on memory",
      level: 2, content: "Whisper is unloaded before pyannote loads.",
      source: "guide", repoPath: "docs/guide/19-inference-providers.md",
    },
  ]),
}));

function req(body: unknown) {
  return new Request("http://localhost/api/docs/ask", {
    method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/docs/ask (#990)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("forwards the retrieved sections to the pipeline as context", async () => {
    const fetchMock = jest.fn(async () => new Response("data: {}\n\n", { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await POST(req({ question: "why is Whisper unloaded before pyannote?" }));

    const [, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.context).toHaveLength(1);
    expect(sent.context[0].slug).toBe("19-inference-providers");
    expect(sent.context[0].anchor).toBe("a-note-on-memory");
    expect(sent.context[0].source).toBe("guide");
    expect(sent.context[0].repo_path).toBe("docs/guide/19-inference-providers.md");
    expect(sent.context[0].text).toContain("Whisper is unloaded");
  });

  it("sends documentation instructions, not the transcript prompt", async () => {
    // The pipeline's stored ask_page_system prompt mandates
    // [Episode Title, MM:SS] citations; docs have neither, and the model
    // emitted "[Context, N/A]" after every claim until this was sent.
    const fetchMock = jest.fn(async () => new Response("data: {}\n\n", { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await POST(req({ question: "why is Whisper unloaded before pyannote?" }));

    const [, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.system_prompt).toContain("Podlog");
    expect(sent.system_prompt).toMatch(/do not add inline citations/i);
  });

  it("answers 400 for a missing question rather than calling the pipeline", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const resp = await POST(req({}));
    expect(resp.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 400 for an unparseable body", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const bad = new Request("http://localhost/api/docs/ask", {
      method: "POST", body: "not json",
      headers: { "Content-Type": "application/json" },
    });
    const resp = await POST(bad);
    expect(resp.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports no match instead of asking the model to guess", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const resp = await POST(req({ question: "zzzz qqqq" }));
    const text = await resp.text();
    expect(text).toContain("No documentation matched");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a pipeline failure rather than hanging the stream", async () => {
    global.fetch = jest.fn(async () => new Response("boom", { status: 502 })) as unknown as typeof fetch;

    const resp = await POST(req({ question: "pyannote diarization" }));
    expect(resp.status).toBe(502);
  });

  it("streams the pipeline body straight back on success", async () => {
    const sse = "event: sources\ndata: []\n\nevent: done\ndata: {}\n\n";
    global.fetch = jest.fn(
      async () => new Response(sse, { status: 200 }),
    ) as unknown as typeof fetch;

    const resp = await POST(req({ question: "why is Whisper unloaded?" }));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toContain("text/event-stream");
    expect(await resp.text()).toBe(sse);
  });
});
