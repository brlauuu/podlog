/**
 * Tests for POST /api/pipeline/ask — SSE proxy to pipeline /api/ask.
 *
 * The route wraps the upstream ReadableStream so client disconnects
 * cancel the upstream fetch cleanly.
 *
 * @jest-environment node
 */
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

jest.mock("@/lib/pipeline", () => ({ PIPELINE_API: "http://pipeline:8000" }));

type RouteModule = typeof import("@/app/api/pipeline/ask/route");
let POST: RouteModule["POST"];

beforeAll(async () => {
  const mod: RouteModule = await import("@/app/api/pipeline/ask/route");
  POST = mod.POST;
});

beforeEach(() => {
  mockFetch.mockReset();
});

function makeReq(body: unknown, signal: AbortSignal = new AbortController().signal) {
  return {
    json: () => Promise.resolve(body),
    signal,
  } as unknown as Parameters<typeof POST>[0];
}

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

async function collectStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value);
  }
  return out;
}

describe("POST /api/pipeline/ask", () => {
  it("forwards body to upstream and streams response with SSE headers", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: streamFromChunks(["event: token\ndata: hi\n\n", "event: done\ndata: {}\n\n"]),
    });

    const resp = await POST(makeReq({ question: "why?", model: "qwen2.5:3b" }));

    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toBe("text/event-stream");
    expect(resp.headers.get("cache-control")).toBe("no-cache");
    expect(resp.headers.get("x-accel-buffering")).toBe("no");

    const streamed = await collectStream(resp.body!);
    expect(streamed).toContain("event: token");
    expect(streamed).toContain("event: done");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://pipeline:8000/api/ask",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: "why?", model: "qwen2.5:3b" }),
      })
    );
  });

  it("returns upstream status with error message when upstream is not ok", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      body: null,
    });

    const resp = await POST(makeReq({ question: "x" }));

    expect(resp.status).toBe(500);
    expect(await resp.text()).toBe("Pipeline API error");
  });

  it("returns error response when upstream is ok but body is null", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
    });

    const resp = await POST(makeReq({ question: "x" }));

    // Route hits the `!resp.ok || !resp.body` branch and returns
    // upstream status with the error message.
    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe("Pipeline API error");
  });

  it("aborts upstream when client abort signal fires", async () => {
    const upstreamSignals: AbortSignal[] = [];
    mockFetch.mockImplementation((_url, init) => {
      upstreamSignals.push(init.signal);
      return Promise.resolve({
        ok: true,
        status: 200,
        body: streamFromChunks(["data: x\n\n"]),
      });
    });

    const clientAbort = new AbortController();
    await POST(makeReq({ question: "x" }, clientAbort.signal));

    expect(upstreamSignals).toHaveLength(1);
    const upstream = upstreamSignals[0];
    expect(upstream.aborted).toBe(false);

    clientAbort.abort();
    expect(upstream.aborted).toBe(true);
  });
});
