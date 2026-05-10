/**
 * @jest-environment node
 */
import { DELETE as deleteDb } from "@/app/api/backups/db/[tier]/[filename]/route";
import { DELETE as deleteAudio } from "@/app/api/backups/audio/[date]/route";

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  mockFetch.mockReset();
});

function jsonResp(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

describe("/api/backups/db/[tier]/[filename] DELETE proxy", () => {
  it("forwards tier and filename to the pipeline", async () => {
    mockFetch.mockReturnValueOnce(jsonResp({ deleted: true }));
    const resp = await deleteDb(new Request("http://localhost"), {
      params: Promise.resolve({ tier: "daily", filename: "podlog-2026-05-10.dump" }),
    });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "/api/backups/db/daily/podlog-2026-05-10.dump",
      ),
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ deleted: true });
  });

  it("URL-encodes path segments", async () => {
    mockFetch.mockReturnValueOnce(jsonResp({ deleted: true }));
    await deleteDb(new Request("http://localhost"), {
      params: Promise.resolve({ tier: "daily", filename: "../escape" }),
    });
    const call = mockFetch.mock.calls[0][0] as string;
    // %2E%2E or ..%2F — anything that prevents the slash from staying raw.
    expect(call.endsWith("daily/..%2Fescape")).toBe(true);
  });

  it("surfaces upstream 4xx unchanged", async () => {
    mockFetch.mockReturnValueOnce(jsonResp({ detail: "bad tier" }, 400));
    const resp = await deleteDb(new Request("http://localhost"), {
      params: Promise.resolve({ tier: "hourly", filename: "podlog-2026-05-10.dump" }),
    });
    expect(resp.status).toBe(400);
    expect(await resp.json()).toEqual({ detail: "bad tier" });
  });
});

describe("/api/backups/audio/[date] DELETE proxy", () => {
  it("forwards the date to the pipeline", async () => {
    mockFetch.mockReturnValueOnce(jsonResp({ deleted: true }));
    const resp = await deleteAudio(new Request("http://localhost"), {
      params: Promise.resolve({ date: "2026-05-09" }),
    });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/backups/audio/2026-05-09"),
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(resp.status).toBe(200);
  });

  it("surfaces upstream 409 (mid-rsync) unchanged", async () => {
    mockFetch.mockReturnValueOnce(jsonResp({ detail: "mid-rsync" }, 409));
    const resp = await deleteAudio(new Request("http://localhost"), {
      params: Promise.resolve({ date: "2026-05-10" }),
    });
    expect(resp.status).toBe(409);
  });
});
