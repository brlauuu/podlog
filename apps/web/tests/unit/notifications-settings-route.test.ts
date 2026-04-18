/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET, PUT } from "@/app/api/notifications/settings/route";

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock("@/lib/pipeline", () => ({ PIPELINE_API: "http://pipeline:8000" }));

beforeEach(() => {
  mockFetch.mockReset();
});

describe("/api/notifications/settings", () => {
  describe("GET", () => {
    it("proxies settings fetch to pipeline without cache", async () => {
      mockFetch.mockResolvedValue({
        status: 200,
        json: async () => ({ email_enabled: true, digest_cadence: "daily" }),
      });

      const resp = await GET();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://pipeline:8000/api/notifications/settings",
        { cache: "no-store" }
      );
      expect(resp.status).toBe(200);
      expect(await resp.json()).toEqual({
        email_enabled: true,
        digest_cadence: "daily",
      });
    });
  });

  describe("PUT", () => {
    it("forwards JSON body and mirrors status", async () => {
      mockFetch.mockResolvedValue({
        status: 200,
        json: async () => ({ updated: true }),
      });

      const req = new NextRequest(
        "http://localhost/api/notifications/settings",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email_enabled: false }),
        }
      );
      const resp = await PUT(req);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://pipeline:8000/api/notifications/settings",
        expect.objectContaining({
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email_enabled: false }),
        })
      );
      expect(resp.status).toBe(200);
      expect(await resp.json()).toEqual({ updated: true });
    });

    it("mirrors validation error from pipeline", async () => {
      mockFetch.mockResolvedValue({
        status: 422,
        json: async () => ({ detail: "invalid digest_cadence" }),
      });

      const req = new NextRequest(
        "http://localhost/api/notifications/settings",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ digest_cadence: "bogus" }),
        }
      );
      const resp = await PUT(req);

      expect(resp.status).toBe(422);
    });
  });
});
