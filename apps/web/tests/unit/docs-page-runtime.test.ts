import { readFileSync } from "fs";
import { resolve } from "path";

import DocsPage from "@/app/docs/page";

jest.mock("@/app/docs/DocsClient", () => ({
  __esModule: true,
  default: (props: { docs: { name: string; title: string }[] }) => {
    capturedDocs = props.docs;
    return null;
  },
}));

let capturedDocs: { name: string; title: string }[] = [];

describe("Docs page runtime behavior", () => {
  it("forces dynamic rendering so mounted docs are read at request time", () => {
    const pageSource = readFileSync(resolve(__dirname, "../../src/app/docs/page.tsx"), "utf-8");
    expect(pageSource).toContain('export const dynamic = "force-dynamic"');
  });

  describe("sidebar listing (#412)", () => {
    beforeAll(async () => {
      capturedDocs = [];
      // Renders against the real docs/guide/ directory on disk.
      const element = await DocsPage();
      const { renderToStaticMarkup } = await import("react-dom/server");
      renderToStaticMarkup(element as React.ReactElement);
    });

    it("lists the guide index first, not last", () => {
      // Plain .sort() put README after every numbered page, because "0" < "R",
      // burying the index at the bottom even though it is the default page.
      expect(capturedDocs[0]?.name).toBe("README");
    });

    it("labels the index 'Overview' rather than its filename", () => {
      expect(capturedDocs[0]?.title).toBe("Overview");
    });

    it("keeps the numbered pages in numeric order after it", () => {
      const rest = capturedDocs.slice(1).map((d) => d.name);
      expect(rest).toEqual([...rest].sort());
      expect(rest[0]).toBe("01-installation");
    });

    it("keeps the index slug as README so /api/docs and deep links still resolve", () => {
      // DocsClient finds the default page via `doc.name === "README"`, and the
      // API route reads docs/guide/README.md. Renaming the slug would break
      // both; only the display title changes.
      expect(capturedDocs.some((d) => d.name === "README")).toBe(true);
    });
  });
});
