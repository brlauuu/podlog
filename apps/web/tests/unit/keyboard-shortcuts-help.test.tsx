/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import KeyboardShortcutsHelp from "@/components/KeyboardShortcutsHelp";

describe("<KeyboardShortcutsHelp>", () => {
  test("'?' opens the overlay and renders the catalog", () => {
    render(<KeyboardShortcutsHelp />);
    expect(screen.queryByText(/Keyboard shortcuts/i)).toBeNull();

    fireEvent.keyDown(window, { key: "?" });

    expect(screen.getByText(/Keyboard shortcuts/i)).toBeInTheDocument();
    // A few entries from the catalog appear (loose check — exact wording can
    // drift over time).
    expect(screen.getByText(/Next episode/i)).toBeInTheDocument();
    expect(screen.getByText(/Play \/ pause/i)).toBeInTheDocument();
    expect(screen.getByText(/Show this help/i)).toBeInTheDocument();
  });

  test("'?' toggles closed when pressed again", () => {
    render(<KeyboardShortcutsHelp />);
    fireEvent.keyDown(window, { key: "?" });
    expect(screen.getByText(/Keyboard shortcuts/i)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "?" });
    // Radix Dialog removes content from the DOM when closed.
    expect(screen.queryByText(/Keyboard shortcuts/i)).toBeNull();
  });
});
