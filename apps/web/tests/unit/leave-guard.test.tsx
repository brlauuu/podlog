/**
 * Keyboard shortcuts that navigate must ask before leaving unsaved Settings
 * changes behind (#1069 follow-up). Clicks are intercepted at the document;
 * router.push from a shortcut never touches the DOM, so it goes through the
 * guard explicitly.
 *
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { confirmLeave, setLeaveGuard } from "@/lib/leaveGuard";
import { useLeaveWarning } from "@/components/UnsavedChanges";
import GlobalChordShortcuts from "@/components/GlobalChordShortcuts";
import GlobalKeyboardShortcuts from "@/components/GlobalKeyboardShortcuts";

const pushMock = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const confirmSpy = jest.spyOn(window, "confirm");

beforeEach(() => {
  pushMock.mockReset();
  confirmSpy.mockReset();
  setLeaveGuard(null);
  window.history.replaceState(null, "", "/settings");
});

describe("confirmLeave", () => {
  it("is a yes when no guard is set", () => {
    expect(confirmLeave("/queue")).toBe(true);
  });

  it("asks the guard, and the guard's answer stands", () => {
    const guard = jest.fn(() => false);
    setLeaveGuard(guard);
    expect(confirmLeave("/queue")).toBe(false);
    guard.mockReturnValue(true);
    expect(confirmLeave("/queue")).toBe(true);
    expect(guard).toHaveBeenCalledTimes(2);
  });

  it("does not ask when the destination is the page already open", () => {
    const guard = jest.fn(() => false);
    setLeaveGuard(guard);
    expect(confirmLeave("/settings")).toBe(true);
    expect(guard).not.toHaveBeenCalled();
  });
});

function Dirty({ dirty }: { dirty: boolean }) {
  useLeaveWarning(dirty);
  return null;
}

describe("shortcuts with unsaved Settings changes", () => {
  it("G Q stays put when the user refuses, and goes when they accept", () => {
    confirmSpy.mockReturnValue(false);
    render(
      <>
        <Dirty dirty />
        <GlobalChordShortcuts />
      </>
    );
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "q" });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(pushMock).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "q" });
    expect(pushMock).toHaveBeenCalledWith("/queue");
  });

  it("G T on the Settings page itself does not ask", () => {
    render(
      <>
        <Dirty dirty />
        <GlobalChordShortcuts />
      </>
    );
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "t" });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith("/settings");
  });

  it('"/" with no search box on the page asks before going to /search', () => {
    confirmSpy.mockReturnValue(false);
    render(
      <>
        <Dirty dirty />
        <GlobalKeyboardShortcuts />
      </>
    );
    fireEvent.keyDown(window, { key: "/" });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("stops asking once the changes are gone", () => {
    const { rerender } = render(
      <>
        <Dirty dirty />
        <GlobalChordShortcuts />
      </>
    );
    rerender(
      <>
        <Dirty dirty={false} />
        <GlobalChordShortcuts />
      </>
    );
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "q" });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith("/queue");
  });
});
