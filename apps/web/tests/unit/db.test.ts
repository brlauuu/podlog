/**
 * Tests for @/lib/db — PostgreSQL connection pool factory.
 *
 * @jest-environment node
 */
jest.mock("pg", () => {
  return {
    Pool: jest.fn().mockImplementation((config: Record<string, unknown>) => ({
      __config: config,
    })),
  };
});

describe("lib/db", () => {
  it("exports a pg Pool constructed with DATABASE_URL and sane defaults", async () => {
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://user:pw@localhost:5432/podlog";

    jest.resetModules();
    const { Pool } = await import("pg");
    const mod = await import("@/lib/db");

    expect(Pool).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: "postgresql://user:pw@localhost:5432/podlog",
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      })
    );
    expect(mod.default).toBeDefined();

    if (original === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = original;
    }
  });
});
