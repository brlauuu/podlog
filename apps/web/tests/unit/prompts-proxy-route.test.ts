/**
 * Tests for the /api/prompts proxy routes (added in #656, covered in
 * #667).
 *
 * Three thin proxies to the pipeline FastAPI:
 *   GET    /api/prompts           — list current prompts
 *   PUT    /api/prompts/[key]     — set a prompt override
 *   POST   /api/prompts/[key]/reset — clear override, fall back to env
 *
 * Each forwards the upstream JSON body verbatim with the upstream
 * status. The web layer doesn't add a fallback shape (the prompts UI
 * surfaces the error itself).
 *
 * @jest-environment node
 */
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

jest.mock("@/lib/pipeline", () => ({ PIPELINE_API: "http://pipeline:8000" }));

type ListModule = typeof import("@/app/api/prompts/route");
type PutModule = typeof import("@/app/api/prompts/[key]/route");
type ResetModule = typeof import("@/app/api/prompts/[key]/reset/route");

let listGET: ListModule["GET"];
let keyPUT: PutModule["PUT"];
let resetPOST: ResetModule["POST"];

beforeAll(async () => {
  listGET = (await import("@/app/api/prompts/route")).GET;
  keyPUT = (await import("@/app/api/prompts/[key]/route")).PUT;
  resetPOST = (await import("@/app/api/prompts/[key]/reset/route")).POST;
});

beforeEach(() => {
  mockFetch.mockReset();
});

describe("GET /api/prompts", () => {
  it("forwards the upstream JSON and status on success", async () => {
    const payload = {
      prompts: [
        { key: "ask_page_system", value: "You are…", overridden: true },
      ],
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(payload),
    });

    const resp = await listGET();

    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual(payload);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://pipeline:8000/api/prompts",
      { cache: "no-store" },
    );
  });

  it("forwards a non-200 upstream status verbatim", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ detail: "boom" }),
    });

    const resp = await listGET();

    expect(resp.status).toBe(500);
    expect(await resp.json()).toEqual({ detail: "boom" });
  });
});

describe("PUT /api/prompts/[key]", () => {
  it("forwards the body to the pipeline with the URL-encoded key", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true }),
    });

    const req = new Request("http://localhost/api/prompts/ask_page_system", {
      method: "PUT",
      body: JSON.stringify({ value: "new text" }),
    });
    const resp = await keyPUT(req as unknown as Parameters<typeof keyPUT>[0], {
      params: Promise.resolve({ key: "ask_page_system" }),
    });

    expect(resp.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://pipeline:8000/api/prompts/ask_page_system");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ value: "new text" });
  });

  it("URL-encodes the key parameter", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true }),
    });

    const req = new Request("http://localhost/api/prompts/x", {
      method: "PUT",
      body: JSON.stringify({ value: "v" }),
    });
    await keyPUT(req as unknown as Parameters<typeof keyPUT>[0], {
      params: Promise.resolve({ key: "weird key/with-slash" }),
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(
      "http://pipeline:8000/api/prompts/weird%20key%2Fwith-slash",
    );
  });

  it("forwards a non-200 upstream status verbatim", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 422,
      json: () => Promise.resolve({ detail: "value too long" }),
    });

    const req = new Request("http://localhost/api/prompts/x", {
      method: "PUT",
      body: JSON.stringify({ value: "v" }),
    });
    const resp = await keyPUT(req as unknown as Parameters<typeof keyPUT>[0], {
      params: Promise.resolve({ key: "x" }),
    });

    expect(resp.status).toBe(422);
    expect(await resp.json()).toEqual({ detail: "value too long" });
  });
});

describe("POST /api/prompts/[key]/reset", () => {
  it("forwards the reset call to the pipeline", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true }),
    });

    const resp = await resetPOST(
      new Request("http://localhost/api/prompts/x/reset", { method: "POST" }),
      { params: Promise.resolve({ key: "ask_page_system" }) },
    );

    expect(resp.status).toBe(200);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(
      "http://pipeline:8000/api/prompts/ask_page_system/reset",
    );
    expect(init.method).toBe("POST");
  });

  it("forwards a non-200 upstream status verbatim", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ detail: "unknown key" }),
    });

    const resp = await resetPOST(
      new Request("http://localhost/api/prompts/unknown/reset", {
        method: "POST",
      }),
      { params: Promise.resolve({ key: "unknown" }) },
    );

    expect(resp.status).toBe(404);
    expect(await resp.json()).toEqual({ detail: "unknown key" });
  });
});
