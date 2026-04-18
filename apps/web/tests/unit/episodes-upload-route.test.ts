/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST } from "@/app/api/episodes/upload/route";

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock("@/lib/pipeline", () => ({ PIPELINE_API: "http://pipeline:8000" }));

beforeEach(() => {
  mockFetch.mockReset();
});

function makeReq(form: FormData) {
  return new NextRequest("http://localhost/api/episodes/upload", {
    method: "POST",
    body: form,
  });
}

describe("POST /api/episodes/upload", () => {
  it("forwards formData to pipeline upload endpoint", async () => {
    mockFetch.mockResolvedValue({
      status: 201,
      json: async () => ({ episode_id: "uploaded-1" }),
    });

    const form = new FormData();
    form.append("title", "My Episode");
    form.append("file", new Blob(["audio-bytes"], { type: "audio/mpeg" }), "ep.mp3");

    const resp = await POST(makeReq(form));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("http://pipeline:8000/api/episodes/upload");
    expect(opts.method).toBe("POST");
    expect(opts.body).toBeInstanceOf(FormData);
    expect((opts.body as FormData).get("title")).toBe("My Episode");
    expect(resp.status).toBe(201);
    expect(await resp.json()).toEqual({ episode_id: "uploaded-1" });
  });

  it("mirrors pipeline error status", async () => {
    mockFetch.mockResolvedValue({
      status: 413,
      json: async () => ({ detail: "file too large" }),
    });

    const form = new FormData();
    form.append("file", new Blob(["x"]), "x.mp3");
    const resp = await POST(makeReq(form));

    expect(resp.status).toBe(413);
    expect(await resp.json()).toEqual({ detail: "file too large" });
  });
});
