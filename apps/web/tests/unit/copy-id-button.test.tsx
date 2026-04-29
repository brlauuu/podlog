import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CopyIdButton from "@/components/CopyIdButton";

function mockClipboard(impl: jest.Mock) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: impl },
    configurable: true,
  });
}

describe("CopyIdButton", () => {
  it("writes the value to the clipboard and flashes a confirmation", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);

    render(<CopyIdButton value="abc-123" label="Copy episode ID" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy episode ID" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("abc-123");
      expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    });
  });

  it("reverts the confirmation after the timeout elapses", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);

    render(<CopyIdButton value="abc-123" label="Copy episode ID" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy episode ID" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument()
    );

    await waitFor(
      () =>
        expect(screen.getByRole("button", { name: "Copy episode ID" })).toBeInTheDocument(),
      { timeout: 3000 }
    );
  });

  it("silently no-ops when the clipboard API rejects", async () => {
    const writeText = jest.fn().mockRejectedValue(new Error("denied"));
    mockClipboard(writeText);

    render(<CopyIdButton value="xyz" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy ID" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("xyz"));
    // Stays in the default state — no "Copied" flash
    expect(screen.getByRole("button", { name: "Copy ID" })).toBeInTheDocument();
  });
});
