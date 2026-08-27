/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { Button } from "@/components/ui/button";

/**
 * #989: every shadcn Button gets a 44px minimum tap area below md:, while
 * desktop keeps the h-9 / h-10 sizes it was designed with.
 *
 * This is a class-string assertion because jsdom applies no CSS and has no
 * layout engine -- it cannot measure a rendered height. What it really
 * guards is the re-copy hazard: `max-md:min-h-11` is not in upstream
 * shadcn, so pasting a fresh copy of button.tsx silently removes it, which
 * is exactly how the dropdown token fix was lost in #848. Whether the
 * result is actually 44px on a phone is measured in a real browser by
 * tests/e2e/mobile-layout.spec.ts.
 */
describe("Button touch target (#989)", () => {
  it.each(["default", "sm", "lg", "icon"] as const)(
    "size=%s carries the mobile minimum height",
    (size) => {
      render(<Button size={size}>Press</Button>);
      expect(screen.getByRole("button").className).toContain("max-md:min-h-11");
    }
  );

  it("keeps its desktop height unchanged", () => {
    render(<Button size="sm">Press</Button>);
    // h-9 is 36px: correct for a mouse, too small for a finger. Both apply;
    // the breakpoint decides which wins.
    expect(screen.getByRole("button").className).toContain("h-9");
  });
});
