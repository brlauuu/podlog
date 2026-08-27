/** @jest-environment node */
/**
 * #937 phase 5: the opt-in "update available" check.
 *
 * The behaviour that matters most here is the one that is easy to get
 * wrong and invisible when you do: a self-hosted app must not make an
 * outbound call the operator did not ask for. Several tests below exist
 * only to assert that nothing reaches the network while the feature is
 * off.
 */

const ORIGINAL_ENV = process.env;

function loadRoute() {
  // Re-import per test: the module holds a cache, and a cache shared
  // across tests would make the "calls GitHub once" assertions lie.
  let mod!: typeof import("@/app/api/update-check/route");
  jest.isolateModules(() => {
    mod = require("@/app/api/update-check/route");
  });
  return mod;
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.restoreAllMocks();
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe("GET /api/update-check (#937)", () => {
  it("is off unless explicitly enabled", async () => {
    delete process.env.UPDATE_CHECK_ENABLED;
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { GET } = loadRoute();
    const body = await (await GET()).json();

    expect(body.enabled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("makes no outbound call when disabled, whatever else is set", async () => {
    process.env.UPDATE_CHECK_ENABLED = "false";
    process.env.NEXT_PUBLIC_APP_VERSION = "0.10.0";
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { GET } = loadRoute();
    await GET();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a newer release when enabled", async () => {
    process.env.UPDATE_CHECK_ENABLED = "true";
    process.env.NEXT_PUBLIC_APP_VERSION = "0.10.0";
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ tag_name: "v1.0.0" }),
    })) as unknown as typeof fetch;

    const { GET } = loadRoute();
    const body = await (await GET()).json();

    expect(body).toMatchObject({ enabled: true, current: "0.10.0", latest: "1.0.0" });
  });

  it("does not report an update when the release equals what is running", async () => {
    process.env.UPDATE_CHECK_ENABLED = "true";
    process.env.NEXT_PUBLIC_APP_VERSION = "1.0.0";
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ tag_name: "v1.0.0" }),
    })) as unknown as typeof fetch;

    const { GET } = loadRoute();
    const body = await (await GET()).json();

    expect(body.latest).toBeNull();
  });

  it("does not report an update when the release is older", async () => {
    // Possible after a deliberate downgrade, or if someone re-tags.
    process.env.UPDATE_CHECK_ENABLED = "true";
    process.env.NEXT_PUBLIC_APP_VERSION = "1.2.0";
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ tag_name: "v1.0.0" }),
    })) as unknown as typeof fetch;

    const { GET } = loadRoute();
    const body = await (await GET()).json();

    expect(body.latest).toBeNull();
  });

  it("stays quiet when GitHub is unreachable", async () => {
    // An air-gapped or offline install must not see an error in the footer.
    process.env.UPDATE_CHECK_ENABLED = "true";
    process.env.NEXT_PUBLIC_APP_VERSION = "0.10.0";
    global.fetch = jest.fn(async () => {
      throw new Error("ENOTFOUND");
    }) as unknown as typeof fetch;

    const { GET } = loadRoute();
    const resp = await GET();
    const body = await resp.json();

    expect(resp.status).toBe(200);
    expect(body).toMatchObject({ enabled: true, latest: null });
  });

  it("stays quiet on a rate-limited or error response", async () => {
    process.env.UPDATE_CHECK_ENABLED = "true";
    process.env.NEXT_PUBLIC_APP_VERSION = "0.10.0";
    global.fetch = jest.fn(async () => ({ ok: false, status: 403 })) as unknown as typeof fetch;

    const { GET } = loadRoute();
    const body = await (await GET()).json();

    expect(body.latest).toBeNull();
  });

  it("asks GitHub once, not once per page view", async () => {
    // Every page render hits this route. Without the cache, a browser tab
    // left open would burn the unauthenticated rate limit on its own.
    process.env.UPDATE_CHECK_ENABLED = "true";
    process.env.NEXT_PUBLIC_APP_VERSION = "0.10.0";
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ tag_name: "v1.0.0" }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { GET } = loadRoute();
    await GET();
    await GET();
    await GET();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
