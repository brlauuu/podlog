import { render, screen, fireEvent } from "@testing-library/react";
import { PyannoteApiKeyField } from "@/components/RemoteInferencePyannoteParts";

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
