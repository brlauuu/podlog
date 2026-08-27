/** @jest-environment node */
/**
 * #1012: where to reach Podlog from another device.
 *
 * The container cannot work this out for itself — it sees only its Docker
 * bridge address. `make up` computes the host's LAN address and passes it
 * in as PODLOG_LAN_URL. When that is absent (a bare `docker compose up`),
 * the route falls back to the address the browser used, which is right
 * whenever you are already browsing over the LAN and useless when you are
 * on localhost — hence the fallback, not the primary.
 */
import { GET } from "@/app/api/lan-address/route";

const ORIGINAL_ENV = process.env;

function req(host: string) {
  return new Request(`http://${host}/api/lan-address`, { headers: { host } });
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});
afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe("GET /api/lan-address (#1012)", () => {
  it("prefers the address make up computed on the host", async () => {
    process.env.PODLOG_LAN_URL = "http://192.168.1.190:3000";
    const body = await (await GET(req("localhost:3000"))).json();
    expect(body).toMatchObject({ url: "http://192.168.1.190:3000", source: "host" });
  });

  it("falls back to the address the browser used", async () => {
    delete process.env.PODLOG_LAN_URL;
    const body = await (await GET(req("192.168.1.190:3000"))).json();
    expect(body).toMatchObject({ url: "http://192.168.1.190:3000", source: "request" });
  });

  it("reports nothing when there is nothing useful to report", async () => {
    // On localhost with no host-supplied address, echoing back
    // "http://localhost:3000" would be worse than silence: it looks like an
    // answer and cannot be typed into a phone.
    delete process.env.PODLOG_LAN_URL;
    const body = await (await GET(req("localhost:3000"))).json();
    expect(body.url).toBeNull();
  });

  it.each(["127.0.0.1:3000", "[::1]:3000", "localhost"])(
    "treats %s as not worth reporting",
    async (host) => {
      delete process.env.PODLOG_LAN_URL;
      const body = await (await GET(req(host))).json();
      expect(body.url).toBeNull();
    }
  );

  it("ignores an empty PODLOG_LAN_URL rather than showing a blank", async () => {
    // docker-compose passes "" when the variable is unset, which is the
    // normal case for a bare `docker compose up`.
    process.env.PODLOG_LAN_URL = "";
    const body = await (await GET(req("192.168.1.190:3000"))).json();
    expect(body).toMatchObject({ url: "http://192.168.1.190:3000", source: "request" });
  });
});
