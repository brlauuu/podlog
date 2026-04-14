import { readFileSync } from "fs";
import { resolve } from "path";

describe("Docs page runtime behavior", () => {
  it("forces dynamic rendering so mounted docs are read at request time", () => {
    const pageSource = readFileSync(resolve(__dirname, "../../src/app/docs/page.tsx"), "utf-8");
    expect(pageSource).toContain('export const dynamic = "force-dynamic"');
  });
});
