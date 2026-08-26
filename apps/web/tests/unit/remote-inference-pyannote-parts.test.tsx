import { render, screen, fireEvent } from "@testing-library/react";
import {
  PyannoteApiKeyField,
  PyannoteCostRateField,
} from "@/components/RemoteInferencePyannoteParts";

describe("PyannoteApiKeyField", () => {
  it("renders the existing value and forwards edits via onChange", () => {
    const onChange = jest.fn();
    render(<PyannoteApiKeyField value="existing-key" onChange={onChange} />);

    const input = screen.getByPlaceholderText("Your pyannote.ai API key") as HTMLInputElement;
    expect(input.value).toBe("existing-key");

    fireEvent.change(input, { target: { value: "pk_xyz" } });

    expect(onChange).toHaveBeenCalledWith("pk_xyz");
  });

  it("toggles the key between masked and visible", () => {
    render(<PyannoteApiKeyField value="pk_secret" onChange={jest.fn()} />);

    const input = () =>
      screen.getByPlaceholderText("Your pyannote.ai API key") as HTMLInputElement;
    expect(input().type).toBe("password");

    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(input().type).toBe("text");

    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(input().type).toBe("password");
  });
});

describe("PyannoteCostRateField (#969)", () => {
  const label = /pyannote cloud rate/i;

  it("renders the saved rate", () => {
    render(<PyannoteCostRateField value={0.0042} onChange={jest.fn()} />);
    expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe("0.0042");
  });

  it("forwards a typed rate as a number, not a string", () => {
    // The server validates with isinstance(rate, (int, float)) and rejects
    // anything else, so sending "0.01" would fail the save.
    const onChange = jest.fn();
    render(<PyannoteCostRateField value={0} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(label), { target: { value: "0.01" } });

    expect(onChange).toHaveBeenCalledWith(0.01);
    expect(typeof onChange.mock.calls[0][0]).toBe("number");
  });

  it("treats a cleared field as 0 rather than NaN", () => {
    // NaN is not finite, so the server would reject it outright.
    const onChange = jest.fn();
    render(<PyannoteCostRateField value={0.01} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(label), { target: { value: "" } });

    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("lets the field be cleared without snapping back to 0", () => {
    // Held as a string internally; coercing the display on every keystroke
    // makes the field impossible to edit.
    render(<PyannoteCostRateField value={0.01} onChange={jest.fn()} />);
    const input = screen.getByLabelText(label) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "" } });

    expect(input.value).toBe("");
  });

  it("flags a negative rate and does not forward it", () => {
    const onChange = jest.fn();
    render(<PyannoteCostRateField value={0} onChange={onChange} />);
    const input = screen.getByLabelText(label);

    fireEvent.change(input, { target: { value: "-1" } });

    expect(onChange).toHaveBeenCalledWith(0);
    expect(onChange).not.toHaveBeenCalledWith(-1);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/non-negative/i)).toBeInTheDocument();
  });

  it("renders an empty field when no rate is stored", () => {
    render(<PyannoteCostRateField value={null} onChange={jest.fn()} />);
    expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe("");
  });

  it("constrains input to non-negative numbers at the browser level", () => {
    render(<PyannoteCostRateField value={0} onChange={jest.fn()} />);
    const input = screen.getByLabelText(label);
    expect(input).toHaveAttribute("type", "number");
    expect(input).toHaveAttribute("min", "0");
  });
});
