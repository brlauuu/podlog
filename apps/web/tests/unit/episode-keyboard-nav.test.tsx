/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render } from "@testing-library/react";
import "@testing-library/jest-dom";
import EpisodeKeyboardNav from "@/components/EpisodeKeyboardNav";

const pushMock = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

beforeEach(() => {
  pushMock.mockReset();
});

describe("<EpisodeKeyboardNav>", () => {
  test("J navigates to the previous episode", () => {
    render(<EpisodeKeyboardNav prevId="ep-prev" nextId="ep-next" />);
    fireEvent.keyDown(window, { key: "j" });
    expect(pushMock).toHaveBeenCalledWith("/episodes/ep-prev");
  });

  test("K navigates to the next episode", () => {
    render(<EpisodeKeyboardNav prevId="ep-prev" nextId="ep-next" />);
    fireEvent.keyDown(window, { key: "k" });
    expect(pushMock).toHaveBeenCalledWith("/episodes/ep-next");
  });

  test("J is a no-op when there is no previous episode", () => {
    render(<EpisodeKeyboardNav prevId={null} nextId="ep-next" />);
    fireEvent.keyDown(window, { key: "j" });
    expect(pushMock).not.toHaveBeenCalled();
  });

  test("K is a no-op when there is no next episode", () => {
    render(<EpisodeKeyboardNav prevId="ep-prev" nextId={null} />);
    fireEvent.keyDown(window, { key: "k" });
    expect(pushMock).not.toHaveBeenCalled();
  });

  test("J is ignored when typing in an input", () => {
    const { container } = render(
      <>
        <input data-testid="t" />
        <EpisodeKeyboardNav prevId="ep-prev" nextId="ep-next" />
      </>,
    );
    const input = container.querySelector("input")!;
    fireEvent.keyDown(input, { key: "j" });
    expect(pushMock).not.toHaveBeenCalled();
  });
});
