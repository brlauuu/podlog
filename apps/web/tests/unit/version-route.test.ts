/**
 * Tests for GET /api/version (#744). Reads the on-disk VERSION file
 * (bind-mounted into the container at /version) and pairs it with the
 * NEXT_PUBLIC_APP_VERSION env var that was baked into the image at
 * build time.
 *
 * @jest-environment node
 */
import { promises as fs } from "fs";

const originalReadFile = fs.readFile;
const readFileMock = jest.fn();

beforeAll(() => {
  // Patch readFile on the fs.promises object so the route can be
  // imported lazily inside each test (so env-var changes take effect).
  (fs as unknown as { readFile: typeof fs.readFile }).readFile =
    readFileMock as unknown as typeof fs.readFile;
});

afterAll(() => {
  (fs as unknown as { readFile: typeof fs.readFile }).readFile = originalReadFile;
});

beforeEach(() => {
  readFileMock.mockReset();
  jest.resetModules();
  // Default — caller overrides per test.
  process.env.NEXT_PUBLIC_APP_VERSION = "0.3.0";
  delete process.env.VERSION_FILE_PATH;
});

async function callRoute() {
  // Lazy import so the route picks up the current env vars.
  const mod: typeof import("@/app/api/version/route") = await import(
    "@/app/api/version/route"
  );
  const resp = await mod.GET();
  return { status: resp.status, body: await resp.json() };
}

describe("GET /api/version", () => {
  it("returns built_in + on_disk when the file is readable", async () => {
    readFileMock.mockResolvedValueOnce("0.4.6\n");

    const { status, body } = await callRoute();

    expect(status).toBe(200);
    expect(body).toEqual({ built_in: "0.3.0", on_disk: "0.4.6" });
    expect(readFileMock).toHaveBeenCalledWith("/version", "utf-8");
  });

  it("trims surrounding whitespace from the file content", async () => {
    readFileMock.mockResolvedValueOnce("  0.4.6  \n\n");

    const { body } = await callRoute();

    expect(body.on_disk).toBe("0.4.6");
  });

  it("returns on_disk=null when the file read fails", async () => {
    readFileMock.mockRejectedValueOnce(new Error("ENOENT"));

    const { status, body } = await callRoute();

    expect(status).toBe(200);
    expect(body.built_in).toBe("0.3.0");
    expect(body.on_disk).toBeNull();
  });

  it("returns on_disk=null for an empty file", async () => {
    readFileMock.mockResolvedValueOnce("   \n");

    const { body } = await callRoute();

    expect(body.on_disk).toBeNull();
  });

  it("returns built_in=null when NEXT_PUBLIC_APP_VERSION is unset", async () => {
    delete process.env.NEXT_PUBLIC_APP_VERSION;
    readFileMock.mockResolvedValueOnce("0.4.6\n");

    const { body } = await callRoute();

    expect(body.built_in).toBeNull();
    expect(body.on_disk).toBe("0.4.6");
  });

  it("honors VERSION_FILE_PATH override", async () => {
    process.env.VERSION_FILE_PATH = "/etc/podlog/version";
    readFileMock.mockResolvedValueOnce("0.5.0");

    await callRoute();

    expect(readFileMock).toHaveBeenCalledWith("/etc/podlog/version", "utf-8");
  });
});
