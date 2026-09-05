/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

const mockQuery = jest.fn();
jest.mock("@/lib/db", () => ({ __esModule: true, default: { query: mockQuery } }));

type RouteModule = typeof import("@/app/api/episodes/[id]/transcript/route");
let GET: RouteModule["GET"];

const ID = "8f017138-af00-4e77-8f2d-f4029ada4205";

beforeAll(async () => {
  const mod: RouteModule = await import("@/app/api/episodes/[id]/transcript/route");
  GET = mod.GET;
});

beforeEach(() => mockQuery.mockReset());

function call(id: string, query = "") {
  const req = new NextRequest(`http://localhost/api/episodes/${id}/transcript${query}`);
  return GET(req, { params: Promise.resolve({ id }) });
}

function stubEpisode(row: Record<string, unknown> | null) {
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM episodes e")) return { rows: row ? [row] : [] };
    if (sql.includes("FROM segments s")) {
      return {
        rows: [
          { id: 1, start_time: 65, end_time: 70, speaker_label: "SPEAKER_00", display_name: "Alice",
            inferred: false, confirmed_by_user: true, role: null, text: "Hi." },
        ],
      };
    }
    throw new Error(`unexpected sql: ${sql}`);
  });
}

const episode = {
  id: ID, title: "Đorđe's Episode", description: null, published_at: null, duration_secs: 120,
  audio_url: "https://x/ep.mp3", guid: "g", feed_title: "The Feed", feed_description: null,
  feed_website_url: null, feed_url: null,
};

describe("GET /api/episodes/[id]/transcript (#1037)", () => {
  it("serves plain text by default with an attachment filename", async () => {
    stubEpisode(episode);
    const resp = await call(ID);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const cd = resp.headers.get("content-disposition")!;
    expect(cd).toContain('attachment; filename="_or_e\'s-Episode_transcript.txt"');
    expect(cd).toContain("filename*=UTF-8''%C4%90or%C4%91e's-Episode_transcript.txt");
    const body = await resp.text();
    expect(body).toContain("Title:        Đorđe's Episode");
    expect(body).toContain("[01:05] Alice:\nHi.");
  });

  it("serves markdown when asked", async () => {
    stubEpisode(episode);
    const resp = await call(ID, "?format=md");
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(resp.headers.get("content-disposition")).toContain("_transcript.md");
    expect(await resp.text()).toContain("- `01:05` **Alice:** Hi.");
  });

  it("rejects other formats", async () => {
    const resp = await call(ID, "?format=srt");
    expect(resp.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("404s for a non-uuid id without touching the database", async () => {
    const resp = await call("not-a-uuid");
    expect(resp.status).toBe(404);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("404s for an unknown episode", async () => {
    stubEpisode(null);
    const resp = await call(ID);
    expect(resp.status).toBe(404);
  });

  it("falls back to 'Untitled Episode' when the title is null", async () => {
    stubEpisode({ ...episode, title: null });
    const resp = await call(ID);
    expect(resp.headers.get("content-disposition")).toContain("Untitled-Episode_transcript.txt");
  });
});
