/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render } from "@testing-library/react";
import "@testing-library/jest-dom";
import GlobalKeyboardShortcuts from "@/components/GlobalKeyboardShortcuts";

const pushMock = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

beforeEach(() => {
  pushMock.mockReset();
});

describe("<GlobalKeyboardShortcuts>", () => {
  test('"/" focuses the marked input when one is present', () => {
    const { container } = render(
      <>
        <input data-shortcut="search-input" data-testid="search" />
        <GlobalKeyboardShortcuts />
      </>,
    );
    const input = container.querySelector(
      'input[data-shortcut="search-input"]',
    ) as HTMLInputElement;
    expect(document.activeElement).not.toBe(input);

    fireEvent.keyDown(window, { key: "/" });

    expect(document.activeElement).toBe(input);
    expect(pushMock).not.toHaveBeenCalled();
  });

  test('"/" navigates to /search when no marked input is present', () => {
    render(<GlobalKeyboardShortcuts />);
    fireEvent.keyDown(window, { key: "/" });
    expect(pushMock).toHaveBeenCalledWith("/search");
  });

  test('"/" is ignored while typing in an unrelated text field', () => {
    render(
      <>
        <textarea data-testid="ta" />
        <GlobalKeyboardShortcuts />
      </>,
    );
    fireEvent.keyDown(document.querySelector("textarea")!, { key: "/" });
    expect(pushMock).not.toHaveBeenCalled();
  });
});
