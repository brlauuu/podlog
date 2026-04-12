/**
 * @jest-environment node
 */
import { GET } from "@/app/api/docs/[slug]/route";
import { NextRequest } from "next/server";

const mockReadFile = jest.fn();
jest.mock("fs/promises", () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

describe("GET /api/docs/[slug]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 200 with markdown content for valid slug", async () => {
    mockReadFile.mockResolvedValue("# Test Doc\n\nHello world");
    const req = new NextRequest("http://localhost/api/docs/01-installation");
    const context = { params: Promise.resolve({ slug: "01-installation" }) };
    const resp = await GET(req, context);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("text/markdown");
  });

  it("returns 200 for README slug", async () => {
    mockReadFile.mockResolvedValue("# Welcome\n\nGuide home");
    const req = new NextRequest("http://localhost/api/docs/README");
    const context = { params: Promise.resolve({ slug: "README" }) };
    const resp = await GET(req, context);
    expect(resp.status).toBe(200);
  });

  it("returns 400 for slug with path traversal attempt", async () => {
    const req = new NextRequest("http://localhost/api/docs/../../../etc/passwd");
    const context = { params: Promise.resolve({ slug: "../../../etc/passwd" }) };
    const resp = await GET(req, context);
    expect(resp.status).toBe(400);
    expect(await resp.text()).toBe("Invalid slug");
  });

  it("returns 400 for slug with special characters", async () => {
    const req = new NextRequest("http://localhost/api/docs/../../config");
    const context = { params: Promise.resolve({ slug: "../../config" }) };
    const resp = await GET(req, context);
    expect(resp.status).toBe(400);
  });

  it("returns 404 for missing file", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    const req = new NextRequest("http://localhost/api/docs/nonexistent");
    const context = { params: Promise.resolve({ slug: "nonexistent" }) };
    const resp = await GET(req, context);
    expect(resp.status).toBe(404);
    expect(await resp.text()).toBe("Not found");
  });

  it("returns 400 for slug with shell characters", async () => {
    const req = new NextRequest("http://localhost/api/docs/test;rm -rf");
    const context = { params: Promise.resolve({ slug: "test;rm -rf" }) };
    const resp = await GET(req, context);
    expect(resp.status).toBe(400);
  });
});
