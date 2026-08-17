/**
 * @jest-environment node
 */
import { getQueryEmbedding, resetEmbeddingCooldown } from "@/lib/search/embedding";

jest.mock("@/lib/pipeline", () => ({ PIPELINE_API: "http://pipeline:8000" }));

const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
  resetEmbeddingCooldown();
  delete process.env.EMBED_TIMEOUT_MS;
  delete process.env.EMBED_COOLDOWN_MS;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getQueryEmbedding", () => {
  it("posts the query text and returns the embedding array on success", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: [0.1, 0.2, 0.3] }),
    });

    const result = await getQueryEmbedding("hello world");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://pipeline:8000/api/embed",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "hello world" }),
      })
    );
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });

  it("returns null when the response is not ok", async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({}) });

    expect(await getQueryEmbedding("x")).toBeNull();
  });

  it("returns null when the fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));

    expect(await getQueryEmbedding("x")).toBeNull();
  });

  it("returns null when the response body is not valid JSON", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    });

    expect(await getQueryEmbedding("x")).toBeNull();
  });

  // #928: an unreachable pipeline used to hang in DNS retry for ~24s, long
  // enough for requests to pile up and exhaust the pg pool behind them.
  describe("timeout (#928)", () => {
    it("passes an abort signal so the fetch cannot hang indefinitely", async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ embedding: [1] }) });

      await getQueryEmbedding("x");

      const init = mockFetch.mock.calls[0][1];
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.signal.aborted).toBe(false);
    });

    it("returns null when the request is aborted by the timeout", async () => {
      process.env.EMBED_TIMEOUT_MS = "10";
      // Resolve only once aborted, the way a real timed-out fetch rejects.
      mockFetch.mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(init.signal.reason));
          })
      );

      expect(await getQueryEmbedding("x")).toBeNull();
    });

    it("honours EMBED_TIMEOUT_MS and falls back to the default when unset or junk", async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ embedding: [1] }) });
      const spy = jest.spyOn(AbortSignal, "timeout");

      process.env.EMBED_TIMEOUT_MS = "500";
      await getQueryEmbedding("x");
      expect(spy).toHaveBeenLastCalledWith(500);

      process.env.EMBED_TIMEOUT_MS = "not-a-number";
      await getQueryEmbedding("x");
      expect(spy).toHaveBeenLastCalledWith(2000);

      process.env.EMBED_TIMEOUT_MS = "0";
      await getQueryEmbedding("x");
      expect(spy).toHaveBeenLastCalledWith(2000);
    });
  });

  describe("cooldown (#928)", () => {
    it("skips the fetch entirely while the cooldown is active", async () => {
      mockFetch.mockRejectedValue(new Error("network down"));

      expect(await getQueryEmbedding("first")).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call must not reach the network at all.
      expect(await getQueryEmbedding("second")).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("opens the cooldown on a non-ok response too, not just a throw", async () => {
      mockFetch.mockResolvedValue({ ok: false, json: async () => ({}) });

      await getQueryEmbedding("first");
      await getQueryEmbedding("second");

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("probes again once the cooldown window has elapsed", async () => {
      process.env.EMBED_COOLDOWN_MS = "1000";
      const start = Date.now();
      const nowSpy = jest.spyOn(Date, "now").mockReturnValue(start);

      mockFetch.mockRejectedValue(new Error("network down"));
      await getQueryEmbedding("first");
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Still inside the window.
      nowSpy.mockReturnValue(start + 999);
      await getQueryEmbedding("second");
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Window elapsed — the next call probes.
      nowSpy.mockReturnValue(start + 1001);
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ embedding: [7] }) });
      expect(await getQueryEmbedding("third")).toEqual([7]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("clears the cooldown after a success so recovery is immediate", async () => {
      process.env.EMBED_COOLDOWN_MS = "1000";
      const start = Date.now();
      const nowSpy = jest.spyOn(Date, "now").mockReturnValue(start);

      mockFetch.mockRejectedValue(new Error("network down"));
      await getQueryEmbedding("first");

      nowSpy.mockReturnValue(start + 1001);
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ embedding: [7] }) });
      await getQueryEmbedding("second");

      // Back inside what would have been a fresh cooldown window: because the
      // previous call succeeded, this one must still hit the network.
      nowSpy.mockReturnValue(start + 1002);
      expect(await getQueryEmbedding("third")).toEqual([7]);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });
});
