/**
 * Tests for /search/print PrintButton (#763).
 */
import { render, screen, fireEvent } from "@testing-library/react";
import PrintButton from "@/app/search/print/PrintButton";

describe("PrintButton", () => {
  it("renders a labelled, no-print button", () => {
    render(<PrintButton />);
    const btn = screen.getByRole("button", { name: /print \/ save as pdf/i });
    expect(btn).toHaveClass("no-print");
  });

  it("invokes window.print on click", () => {
    const printSpy = jest.fn();
    const original = window.print;
    window.print = printSpy;
    try {
      render(<PrintButton />);
      fireEvent.click(screen.getByRole("button"));
      expect(printSpy).toHaveBeenCalledTimes(1);
    } finally {
      window.print = original;
    }
  });
});
