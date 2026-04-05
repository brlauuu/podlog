/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HelpMenu from "@/components/HelpMenu";

// Mock WizardProvider
const mockSetOpen = jest.fn();
jest.mock("@/components/WizardProvider", () => ({
  useWizard: () => ({ open: false, setOpen: mockSetOpen, markCompleted: jest.fn() }),
}));

// Mock TanStack React Query for the health check
jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isLoading: true }),
}));

beforeEach(() => {
  mockSetOpen.mockReset();
});

describe("HelpMenu", () => {
  it("renders the help button", () => {
    render(<HelpMenu />);
    expect(screen.getByRole("button", { name: /help/i })).toBeInTheDocument();
  });

  it("shows dropdown items on click", async () => {
    const user = userEvent.setup();
    render(<HelpMenu />);
    await user.click(screen.getByRole("button", { name: /help/i }));
    await waitFor(() => {
      expect(screen.getByText("Setup Wizard")).toBeInTheDocument();
      expect(screen.getByText("User Guide")).toBeInTheDocument();
      expect(screen.getByText("System status")).toBeInTheDocument();
    });
  });

  it("opens wizard when Setup Wizard is clicked", async () => {
    const user = userEvent.setup();
    render(<HelpMenu />);
    await user.click(screen.getByRole("button", { name: /help/i }));
    await waitFor(() => screen.getByText("Setup Wizard"));
    await user.click(screen.getByText("Setup Wizard"));
    expect(mockSetOpen).toHaveBeenCalledWith(true);
  });
});
