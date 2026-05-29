/**
 * @jest-environment jsdom
 *
 * Tests for the small fetch-helpers module that the /feeds page uses
 * (#664 split, coverage gap closed in #765).
 */
import {
  fetchFeeds,
  fetchPreview,
  fetchFeedEpisodeGuids,
} from "@/app/feeds/_lib/api";

type FetchMock = jest.Mock<Promise<Partial<Response>>, [RequestInfo, RequestInit?]>;

function mockFetch(impl: (url: string, init?: RequestInit) => Partial<Response>): FetchMock {
  const fn = jest.fn(async (url: RequestInfo, init?: RequestInit) =>
    impl(typeof url === "string" ? url : url.toString(), init),
  ) as unknown as FetchMock;
  (global.fetch as unknown) = fn;
  return fn;
}

function ok(body: unknown): Partial<Response> {
  return { ok: true, json: async () => body } as Partial<Response>;
}

function fail(status: number, body?: unknown): Partial<Response> {
  return {
    ok: false,
    status,
    json: async () => body ?? { detail: `boom-${status}` },
  } as Partial<Response>;
}

describe("feeds/_lib/api", () => {
  describe("fetchFeeds", () => {
    it("returns the parsed feed list on 2xx", async () => {
      mockFetch(() => ok([{ id: "f1", url: "https://ex.com/a.xml" }]));
      const out = await fetchFeeds();
      expect(out).toEqual([{ id: "f1", url: "https://ex.com/a.xml" }]);
    });

    it("throws on non-2xx", async () => {
      mockFetch(() => fail(500));
      await expect(fetchFeeds()).rejects.toThrow("Failed to load feeds");
    });
  });

  describe("fetchPreview", () => {
    it("url-encodes the feed URL in the query string", async () => {
      const fn = mockFetch(() => ok({ title: "T", episodes: [] }));
      await fetchPreview("https://example.com/path?a=1&b=2");
      const calledWith = fn.mock.calls[0][0] as string;
      expect(calledWith).toContain(
        "url=https%3A%2F%2Fexample.com%2Fpath%3Fa%3D1%26b%3D2",
      );
    });

    it("returns the parsed preview on 2xx", async () => {
      mockFetch(() => ok({ title: "T", episodes: [{ guid: "g1" }] }));
      const out = await fetchPreview("https://ex.com/feed.xml");
      expect(out.title).toBe("T");
    });

    it("surfaces the server-provided detail string on error", async () => {
      mockFetch(() => fail(422, { detail: "Not a feed" }));
      await expect(fetchPreview("nope")).rejects.toThrow("Not a feed");
    });

    it("falls back to a generic message when the error body has no detail", async () => {
      mockFetch(() => fail(500, {}));
      await expect(fetchPreview("nope")).rejects.toThrow("Failed to load feed preview");
    });

    it("falls back when the error body is not valid JSON", async () => {
      (global.fetch as unknown) = jest.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error("not json");
        },
      })) as unknown as typeof fetch;
      await expect(fetchPreview("nope")).rejects.toThrow("Failed to load feed preview");
    });
  });

  describe("fetchFeedEpisodeGuids", () => {
    it("returns the GUID array on 2xx", async () => {
      mockFetch(() => ok(["g1", "g2", "g3"]));
      const out = await fetchFeedEpisodeGuids("feed-7");
      expect(out).toEqual(["g1", "g2", "g3"]);
    });

    it("hits the /api/feeds/{id}/episodes/guids path", async () => {
      const fn = mockFetch(() => ok([]));
      await fetchFeedEpisodeGuids("feed-9");
      expect(fn.mock.calls[0][0]).toBe("/api/feeds/feed-9/episodes/guids");
    });

    it("surfaces the server detail on error", async () => {
      mockFetch(() => fail(404, { detail: "Feed not found" }));
      await expect(fetchFeedEpisodeGuids("missing")).rejects.toThrow(
        "Feed not found",
      );
    });

    it("falls back to a generic error message when detail is absent", async () => {
      mockFetch(() => fail(500, {}));
      await expect(fetchFeedEpisodeGuids("x")).rejects.toThrow(
        "Failed to load existing episodes",
      );
    });
  });
});
