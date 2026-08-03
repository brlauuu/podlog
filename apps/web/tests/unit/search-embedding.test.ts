/**
 * @jest-environment node
 */
import { getQueryEmbedding } from "@/lib/search/embedding";

jest.mock("@/lib/pipeline", () => ({ PIPELINE_API: "http://pipeline:8000" }));

const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
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
});
