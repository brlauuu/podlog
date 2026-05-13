/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useKeyboardShortcut, type ShortcutOptions } from "@/lib/useKeyboardShortcut";

function Probe({ opts }: { opts: ShortcutOptions }) {
  useKeyboardShortcut(opts);
  return (
    <div>
      <input data-testid="text-input" />
      <textarea data-testid="text-area" />
      <div data-testid="content-editable" contentEditable />
    </div>
  );
}

describe("useKeyboardShortcut", () => {
  test("fires when the matching key is pressed", () => {
    const handler = jest.fn();
    render(<Probe opts={{ key: "x", handler }} />);

    fireEvent.keyDown(window, { key: "x" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("ignores other keys", () => {
    const handler = jest.fn();
    render(<Probe opts={{ key: "j", handler }} />);

    fireEvent.keyDown(window, { key: "k" });
    expect(handler).not.toHaveBeenCalled();
  });

  test("skips when target is <input>", () => {
    const handler = jest.fn();
    const { getByTestId } = render(<Probe opts={{ key: "/", handler }} />);

    fireEvent.keyDown(getByTestId("text-input"), { key: "/" });
    expect(handler).not.toHaveBeenCalled();
  });

  test("skips when target is <textarea>", () => {
    const handler = jest.fn();
    const { getByTestId } = render(<Probe opts={{ key: "j", handler }} />);
    fireEvent.keyDown(getByTestId("text-area"), { key: "j" });
    expect(handler).not.toHaveBeenCalled();
  });

  test("skips when target is contenteditable", () => {
    const handler = jest.fn();
    const { getByTestId } = render(<Probe opts={{ key: "j", handler }} />);
    fireEvent.keyDown(getByTestId("content-editable"), { key: "j" });
    expect(handler).not.toHaveBeenCalled();
  });

  test("allowInInputs fires inside inputs", () => {
    const handler = jest.fn();
    const { getByTestId } = render(
      <Probe opts={{ key: "Escape", handler, allowInInputs: true }} />,
    );
    fireEvent.keyDown(getByTestId("text-input"), { key: "Escape" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("withCtrlOrMeta requires a modifier", () => {
    const handler = jest.fn();
    render(<Probe opts={{ key: "k", handler, withCtrlOrMeta: true }} />);

    fireEvent.keyDown(window, { key: "k" });
    expect(handler).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(handler).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  test("does not register when enabled=false", () => {
    const handler = jest.fn();
    render(<Probe opts={{ key: "j", handler, enabled: false }} />);
    fireEvent.keyDown(window, { key: "j" });
    expect(handler).not.toHaveBeenCalled();
  });

  test("removes the listener on unmount", () => {
    const handler = jest.fn();
    const { unmount } = render(<Probe opts={{ key: "j", handler }} />);
    fireEvent.keyDown(window, { key: "j" });
    expect(handler).toHaveBeenCalledTimes(1);
    unmount();
    fireEvent.keyDown(window, { key: "j" });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
