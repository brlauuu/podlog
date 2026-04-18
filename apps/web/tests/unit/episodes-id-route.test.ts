/**
 * @jest-environment node
 */
import { DELETE } from "@/app/api/episodes/[id]/route";

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock("@/lib/pipeline", () => ({ PIPELINE_API: "http://pipeline:8000" }));

beforeEach(() => {
  mockFetch.mockReset();
});

function call(id: string) {
  const req = new Request(`http://localhost/api/episodes/${id}`, {
    method: "DELETE",
  });
  return DELETE(req, { params: Promise.resolve({ id }) });
}

describe("DELETE /api/episodes/[id]", () => {
  it("returns empty 204 when pipeline returns 204", async () => {
    mockFetch.mockResolvedValue({
      status: 204,
      text: async () => "",
    });

    const resp = await call("ep-1");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://pipeline:8000/api/episodes/ep-1",
      { method: "DELETE" }
    );
    expect(resp.status).toBe(204);
    expect(await resp.text()).toBe("");
  });

  it("forwards JSON error body when upstream returns JSON", async () => {
    mockFetch.mockResolvedValue({
      status: 409,
      text: async () => JSON.stringify({ detail: "episode locked" }),
    });

    const resp = await call("ep-2");

    expect(resp.status).toBe(409);
    expect(await resp.json()).toEqual({ detail: "episode locked" });
  });

  it("wraps non-JSON error text in a detail field", async () => {
    mockFetch.mockResolvedValue({
      status: 500,
      text: async () => "Internal Server Error",
    });

    const resp = await call("ep-3");

    expect(resp.status).toBe(500);
    expect(await resp.json()).toEqual({ detail: "Internal Server Error" });
  });

  it("uses fallback detail when upstream returns empty non-JSON body", async () => {
    mockFetch.mockResolvedValue({
      status: 500,
      text: async () => "",
    });

    const resp = await call("ep-4");

    expect(resp.status).toBe(500);
    expect(await resp.json()).toEqual({
      detail: "Pipeline API returned a non-JSON error",
    });
  });
});
