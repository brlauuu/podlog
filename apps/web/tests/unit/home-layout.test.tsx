/**
 * @jest-environment jsdom
 */
import React from "react";
import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import HomeLayout from "@/components/HomeLayout";

// #1086: the logo and buttons must sit where they would with no recent list,
// and the list arriving after load must not move them.

describe("HomeLayout", () => {
  const originalRO = global.ResizeObserver;
  let observed: ResizeObserverCallback | null = null;

  afterEach(() => {
    global.ResizeObserver = originalRO;
    observed = null;
    jest.restoreAllMocks();
  });

  test("without ResizeObserver both spacers grow from a zero basis, centring the hero", () => {
    // jsdom has no ResizeObserver, which is also what the server render sees.
    // basis-0, not flex-1: a 0% basis against main's indefinite height
    // resolves to content size and sat the hero 16px above centre.
    render(<HomeLayout hero={<p>hero</p>}><p>list</p></HomeLayout>);

    const top = screen.getByTestId("home-top-spacer");
    const below = screen.getByTestId("home-recent-row");
    for (const spacer of [top, below]) {
      expect(spacer.className).toContain("grow");
      expect(spacer.className).toContain("basis-0");
      expect(spacer.className).not.toContain("flex-1");
    }
    expect(top).not.toHaveAttribute("style");
  });

  test("pins the top spacer to its no-list height, worked out from the viewport", () => {
    global.ResizeObserver = class {
      constructor(cb: ResizeObserverCallback) {
        observed = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;

    // Viewport 800 tall; root starts 93px down (navbar + main's top padding),
    // main has 32px bottom padding, footer is 69px: 606px to fill. The hero
    // is 260px tall, so (606 - 260) / 2 = 173px above it.
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    const footer = document.createElement("footer");
    jest.spyOn(footer, "offsetHeight", "get").mockReturnValue(69);
    document.body.appendChild(footer);
    jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ top: 93 } as DOMRect);
    jest
      .spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        if (this.tagName === "FOOTER") return 69;
        return this.dataset.testid === "home-hero" ? 260 : 0;
      });

    render(
      <main style={{ paddingBottom: "32px" }}>
        <HomeLayout hero={<p>hero</p>}><p>list</p></HomeLayout>
      </main>,
    );

    const top = screen.getByTestId("home-top-spacer");
    expect(top).toHaveStyle({ height: "173px" });
    expect(top.className).toContain("flex-none");

    // A taller list resizes the lower spacer; the pin must not change.
    act(() => observed?.([], {} as ResizeObserver));
    expect(top).toHaveStyle({ height: "173px" });

    // A taller viewport moves it, exactly as it would with no list.
    Object.defineProperty(window, "innerHeight", { value: 1000, configurable: true });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(top).toHaveStyle({ height: "273px" });

    footer.remove();
  });
});
