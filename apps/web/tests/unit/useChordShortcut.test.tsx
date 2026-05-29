/**
 * @jest-environment jsdom
 */
import React from "react";
import { act, fireEvent, render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useChordShortcut, type ChordOptions } from "@/lib/useChordShortcut";

function Probe({ opts }: { opts: ChordOptions }) {
  useChordShortcut(opts);
  return (
    <div>
      <input data-testid="text-input" />
    </div>
  );
}

describe("useChordShortcut", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("fires the handler when prefix + mapped key are pressed in sequence", () => {
    const h = jest.fn();
    render(<Probe opts={{ prefix: "g", map: { h } }} />);

    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "h" });
    expect(h).toHaveBeenCalledTimes(1);
  });

  test("is case-insensitive for both prefix and target", () => {
    const h = jest.fn();
    render(<Probe opts={{ prefix: "g", map: { h } }} />);

    fireEvent.keyDown(window, { key: "G" });
    fireEvent.keyDown(window, { key: "H" });
    expect(h).toHaveBeenCalledTimes(1);
  });

  test("does not fire when the second key is unmapped", () => {
    const h = jest.fn();
    render(<Probe opts={{ prefix: "g", map: { h } }} />);

    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "z" });
    expect(h).not.toHaveBeenCalled();
  });

  test("resets after the timeout so a late second key does not trigger", () => {
    const h = jest.fn();
    render(<Probe opts={{ prefix: "g", map: { h }, timeoutMs: 1000 }} />);

    fireEvent.keyDown(window, { key: "g" });
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    fireEvent.keyDown(window, { key: "h" });
    expect(h).not.toHaveBeenCalled();
  });

  test("does not arm while a modifier key is held", () => {
    const h = jest.fn();
    render(<Probe opts={{ prefix: "g", map: { h } }} />);

    // Cmd+G should be left to the browser (find next).
    fireEvent.keyDown(window, { key: "g", metaKey: true });
    fireEvent.keyDown(window, { key: "h" });
    expect(h).not.toHaveBeenCalled();
  });

  test("disarms if a modifier appears on the second keystroke", () => {
    const h = jest.fn();
    render(<Probe opts={{ prefix: "g", map: { h } }} />);

    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "h", ctrlKey: true });
    expect(h).not.toHaveBeenCalled();
  });

  test("skips registration when focused inside <input>", () => {
    const h = jest.fn();
    const { getByTestId } = render(<Probe opts={{ prefix: "g", map: { h } }} />);
    const input = getByTestId("text-input");

    fireEvent.keyDown(input, { key: "g" });
    fireEvent.keyDown(input, { key: "h" });
    expect(h).not.toHaveBeenCalled();
  });

  test("pressing the prefix twice re-arms (does not trigger anything)", () => {
    const handlers = { h: jest.fn(), g: jest.fn() };
    render(<Probe opts={{ prefix: "g", map: handlers }} />);

    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "g" });
    // Second 'g' is treated as the second keystroke matching map['g'] — which IS
    // defined here for the test. Then a follow-up 'h' should NOT fire because
    // chord is already consumed.
    expect(handlers.g).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "h" });
    expect(handlers.h).not.toHaveBeenCalled();
  });

  test("does nothing when enabled=false", () => {
    const h = jest.fn();
    render(<Probe opts={{ prefix: "g", map: { h }, enabled: false }} />);

    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "h" });
    expect(h).not.toHaveBeenCalled();
  });

  test("cleans up its listener on unmount", () => {
    const h = jest.fn();
    const { unmount } = render(<Probe opts={{ prefix: "g", map: { h } }} />);
    unmount();

    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "h" });
    expect(h).not.toHaveBeenCalled();
  });
});
