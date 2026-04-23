import { render, screen, fireEvent } from "@testing-library/react";
import ExpandModal from "@/app/meta-analysis/ExpandModal";

describe("ExpandModal", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <ExpandModal open={false} onClose={() => {}} title="Test Title">
        <p>Content</p>
      </ExpandModal>
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders title and children when open", () => {
    render(
      <ExpandModal open onClose={() => {}} title="My Chart">
        <p>Chart detail content</p>
      </ExpandModal>
    );
    expect(screen.getByText("My Chart")).toBeInTheDocument();
    expect(screen.getByText("Chart detail content")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = jest.fn();
    render(
      <ExpandModal open onClose={onClose} title="My Chart">
        <p>Content</p>
      </ExpandModal>
    );
    fireEvent.click(screen.getByLabelText("Close dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = jest.fn();
    render(
      <ExpandModal open onClose={onClose} title="My Chart">
        <p>Content</p>
      </ExpandModal>
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when backdrop is clicked", () => {
    const onClose = jest.fn();
    const { container } = render(
      <ExpandModal open onClose={onClose} title="My Chart">
        <p>Content</p>
      </ExpandModal>
    );
    // The first child is the backdrop fixed div.
    fireEvent.click(container.firstChild as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when inner panel is clicked", () => {
    const onClose = jest.fn();
    render(
      <ExpandModal open onClose={onClose} title="My Chart">
        <p>Content</p>
      </ExpandModal>
    );
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
