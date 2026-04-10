/**
 * @jest-environment jsdom
 */
import React from "react";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockPathname = jest.fn();
const mockAudioState = { src: null as string | null };

jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));

jest.mock("@/components/AudioPlayerContext", () => ({
  useAudioPlayer: () => ({ state: mockAudioState }),
}));

import MainContent from "@/components/MainContent";

describe("MainContent home layout behavior", () => {
  beforeEach(() => {
    mockPathname.mockReset();
    mockAudioState.src = null;
  });

  test("enables flex-column container on home route for vertical centering", () => {
    mockPathname.mockReturnValue("/");
    const { container } = render(
      <MainContent>
        <div>content</div>
      </MainContent>
    );
    const main = container.querySelector("main");
    expect(main?.className).toContain("flex");
    expect(main?.className).toContain("flex-col");
  });

  test("does not force flex-column on non-home routes", () => {
    mockPathname.mockReturnValue("/search");
    const { container } = render(
      <MainContent>
        <div>content</div>
      </MainContent>
    );
    const main = container.querySelector("main");
    expect(main?.className).not.toContain("flex-col");
  });
});
