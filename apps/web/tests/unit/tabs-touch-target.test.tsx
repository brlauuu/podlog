/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * #989: tab triggers get a 44px tap area below md:. Settings uses four of
 * them, and the Meta-Analysis page two more.
 *
 * A class-string assertion, like the Button one: jsdom has no layout engine.
 * What it guards is the re-copy hazard -- `max-md:min-h-11` is not upstream
 * shadcn, so pasting a fresh tabs.tsx silently removes it (cf. #848). The
 * rendered height is measured in a browser by tests/e2e/mobile-layout.spec.ts.
 */
describe("TabsTrigger touch target (#989)", () => {
  it("carries the mobile minimum height", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">First</TabsTrigger>
        </TabsList>
      </Tabs>
    );
    expect(screen.getByRole("tab").className).toContain("max-md:min-h-11");
  });
});
