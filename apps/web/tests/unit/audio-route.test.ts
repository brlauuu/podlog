/**
 * Unit tests for GET /api/audio/[episodeId]/[filename] — PRD-02 §5.2, §11
 *
 * Exercises the real route handler with mocked DB + fs to cover:
 * - episode validation (404 when missing)
 * - filename/episode mismatch (404)
 * - path traversal neutralisation (basename-stripped, then 404 if not found)
 * - file resolution across archive + raw dirs
 * - Range and non-Range responses
 * - content-type selection per extension
 *
 * @jest-environment node
 */
import { EventEmitter } from "events";
import path from "path";
import { NextRequest } from "next/server";

const mockQuery = jest.fn();
jest.mock("@/lib/db", () => ({ __esModule: true, default: { query: mockQuery } }));

const mockExistsSync = jest.fn();
const mockStatSync = jest.fn();
const mockCreateReadStream = jest.fn();
jest.mock("fs", () => ({
  __esModule: true,
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    statSync: (...args: unknown[]) => mockStatSync(...args),
    createReadStream: (...args: unknown[]) => mockCreateReadStream(...args),
  },
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  statSync: (...args: unknown[]) => mockStatSync(...args),
  createReadStream: (...args: unknown[]) => mockCreateReadStream(...args),
}));

function makeFakeStream(chunks: Buffer[] = [Buffer.from("audio-bytes")]) {
  const ee = new EventEmitter() as EventEmitter & { destroy?: () => void };
  setImmediate(() => {
    for (const c of chunks) ee.emit("data", c);
    ee.emit("end");
  });
  return ee;
}

async function readBody(resp: Response): Promise<Buffer> {
  const ab = await resp.arrayBuffer();
  return Buffer.from(ab);
}

type RouteModule = typeof import("@/app/api/audio/[episodeId]/[filename]/route");
let GET: RouteModule["GET"];

beforeAll(async () => {
  const mod: RouteModule = await import("@/app/api/audio/[episodeId]/[filename]/route");
  GET = mod.GET;
});

beforeEach(() => {
  mockQuery.mockReset();
  mockExistsSync.mockReset();
  mockStatSync.mockReset();
  mockCreateReadStream.mockReset();
});

function callGET(episodeId: string, filename: string, headers: Record<string, string> = {}) {
  const req = new NextRequest(
    `http://localhost/api/audio/${episodeId}/${encodeURIComponent(filename)}`,
    { headers }
  );
  return GET(req, {
    params: Promise.resolve({ episodeId, filename }),
  });
}

describe("GET /api/audio/[episodeId]/[filename]", () => {
  it("returns 404 when episode does not exist", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const resp = await callGET("missing-id", "ep.mp3");

    expect(resp.status).toBe(404);
    expect(await resp.text()).toBe("Episode not found");
    expect(mockQuery).toHaveBeenCalledWith(
      "SELECT audio_local_path FROM episodes WHERE id = $1",
      ["missing-id"]
    );
  });

  it("returns 404 when filename does not match the episode's audio file", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ audio_local_path: "/data/audio/archive/real-file.mp3" }],
    });

    const resp = await callGET("ep-1", "attacker.mp3");

    expect(resp.status).toBe(404);
    expect(await resp.text()).toBe("File does not belong to this episode");
    expect(mockExistsSync).not.toHaveBeenCalled();
  });

  it("strips path separators from filename (path traversal prevention)", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ audio_local_path: "/data/audio/archive/passwd" }],
    });
    mockExistsSync.mockReturnValue(false);

    const resp = await callGET("ep-1", "../../../etc/passwd");

    expect(resp.status).toBe(404);
    const calledPaths = mockExistsSync.mock.calls.map((c) => c[0]);
    for (const p of calledPaths) {
      expect(typeof p).toBe("string");
      expect(p).not.toContain("..");
      expect(
        p.startsWith("/data/audio/archive/") || p.startsWith("/data/audio/raw/")
      ).toBe(true);
    }
  });

  it("returns 404 when file is absent from both audio directories", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ audio_local_path: "/data/audio/archive/ep.mp3" }],
    });
    mockExistsSync.mockReturnValue(false);

    const resp = await callGET("ep-1", "ep.mp3");

    expect(resp.status).toBe(404);
    expect(await resp.text()).toBe("Not found");
    const tried = mockExistsSync.mock.calls.map((c) => c[0]);
    expect(tried).toEqual([
      path.resolve("/data/audio/archive", "ep.mp3"),
      path.resolve("/data/audio/raw", "ep.mp3"),
    ]);
  });

  it("streams the full file with correct headers when no Range header is provided", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ audio_local_path: "/data/audio/archive/ep.mp3" }],
    });
    mockExistsSync.mockImplementation((p: string) => p.endsWith("archive/ep.mp3"));
    mockStatSync.mockReturnValue({ size: 1234 });
    mockCreateReadStream.mockReturnValue(makeFakeStream([Buffer.from("audio-bytes")]));

    const resp = await callGET("ep-1", "ep.mp3");

    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(resp.headers.get("Content-Length")).toBe("1234");
    expect(resp.headers.get("Accept-Ranges")).toBe("bytes");
    expect(mockCreateReadStream).toHaveBeenCalledWith(
      path.resolve("/data/audio/archive", "ep.mp3")
    );
    expect(await readBody(resp)).toEqual(Buffer.from("audio-bytes"));
  });

  it("falls back to raw dir when file is not in archive", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ audio_local_path: "/data/audio/raw/ep.mp3" }],
    });
    mockExistsSync.mockImplementation((p: string) => p.endsWith("raw/ep.mp3"));
    mockStatSync.mockReturnValue({ size: 10 });
    mockCreateReadStream.mockReturnValue(makeFakeStream([Buffer.from("x")]));

    const resp = await callGET("ep-1", "ep.mp3");

    expect(resp.status).toBe(200);
    expect(mockCreateReadStream).toHaveBeenCalledWith(
      path.resolve("/data/audio/raw", "ep.mp3")
    );
  });

  it("handles Range requests with 206 and correct Content-Range", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ audio_local_path: "/data/audio/archive/ep.mp3" }],
    });
    mockExistsSync.mockImplementation((p: string) => p.endsWith("archive/ep.mp3"));
    mockStatSync.mockReturnValue({ size: 1000 });
    mockCreateReadStream.mockReturnValue(makeFakeStream([Buffer.from("range-bytes")]));

    const resp = await callGET("ep-1", "ep.mp3", { range: "bytes=100-199" });

    expect(resp.status).toBe(206);
    expect(resp.headers.get("Content-Range")).toBe("bytes 100-199/1000");
    expect(resp.headers.get("Content-Length")).toBe("100");
    expect(resp.headers.get("Accept-Ranges")).toBe("bytes");
    expect(mockCreateReadStream).toHaveBeenCalledWith(
      path.resolve("/data/audio/archive", "ep.mp3"),
      { start: 100, end: 199 }
    );
  });

  it("defaults open-ended Range end to fileSize - 1", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ audio_local_path: "/data/audio/archive/ep.mp3" }],
    });
    mockExistsSync.mockImplementation((p: string) => p.endsWith("archive/ep.mp3"));
    mockStatSync.mockReturnValue({ size: 500 });
    mockCreateReadStream.mockReturnValue(makeFakeStream());

    const resp = await callGET("ep-1", "ep.mp3", { range: "bytes=10-" });

    expect(resp.status).toBe(206);
    expect(resp.headers.get("Content-Range")).toBe("bytes 10-499/500");
    expect(resp.headers.get("Content-Length")).toBe("490");
    expect(mockCreateReadStream).toHaveBeenCalledWith(expect.any(String), {
      start: 10,
      end: 499,
    });
  });

  it.each([
    ["ep.mp3", "audio/mpeg"],
    ["ep.m4a", "audio/mp4"],
    ["ep.mp4", "audio/mp4"],
    ["ep.ogg", "audio/ogg"],
    ["ep.wav", "audio/wav"],
    ["ep.flac", "audio/flac"],
    ["ep.opus", "audio/opus"],
    ["ep.aac", "audio/aac"],
    ["ep.wma", "audio/x-ms-wma"],
    ["ep.unknown", "audio/mpeg"],
    ["ep-no-ext", "audio/mpeg"],
  ])("sets Content-Type for %s to %s", async (filename, expected) => {
    mockQuery.mockResolvedValue({
      rows: [{ audio_local_path: `/data/audio/archive/${filename}` }],
    });
    mockExistsSync.mockImplementation((p: string) => p.endsWith(filename));
    mockStatSync.mockReturnValue({ size: 1 });
    mockCreateReadStream.mockReturnValue(makeFakeStream());

    const resp = await callGET("ep-1", filename);

    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe(expected);
  });

  it("allows access when episode has no recorded audio_local_path", async () => {
    mockQuery.mockResolvedValue({ rows: [{ audio_local_path: null }] });
    mockExistsSync.mockImplementation((p: string) => p.endsWith("archive/ep.mp3"));
    mockStatSync.mockReturnValue({ size: 5 });
    mockCreateReadStream.mockReturnValue(makeFakeStream());

    const resp = await callGET("ep-1", "ep.mp3");

    expect(resp.status).toBe(200);
  });
});
