/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render } from "@testing-library/react";
import "@testing-library/jest-dom";
import GlobalChordShortcuts from "@/components/GlobalChordShortcuts";

const pushMock = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

beforeEach(() => {
  pushMock.mockReset();
});

describe("<GlobalChordShortcuts>", () => {
  test.each([
    ["h", "/"],
    ["q", "/queue"],
    ["f", "/feeds"],
    ["p", "/podcasts"],
    ["a", "/ask"],
    ["m", "/meta-analysis"],
    ["s", "/settings"],
    ["d", "/docs"],
  ])("G %s navigates to %s", (target, path) => {
    render(<GlobalChordShortcuts />);
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: target });
    expect(pushMock).toHaveBeenCalledWith(path);
  });

  test("an unmapped second key does not navigate", () => {
    render(<GlobalChordShortcuts />);
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "z" });
    expect(pushMock).not.toHaveBeenCalled();
  });

  test("a lone G does not navigate", () => {
    render(<GlobalChordShortcuts />);
    fireEvent.keyDown(window, { key: "g" });
    expect(pushMock).not.toHaveBeenCalled();
  });
});
