import { render, screen, fireEvent } from "@testing-library/react";
import { FireworksApiKeyField } from "@/components/RemoteInferenceFireworksParts";

describe("FireworksApiKeyField", () => {
  it("forwards typed input via onChange", () => {
    const onChange = jest.fn();
    render(<FireworksApiKeyField value={null} onChange={onChange} />);

    const input = screen.getByPlaceholderText("fw_...") as HTMLInputElement;
    expect(input.value).toBe("");

    fireEvent.change(input, { target: { value: "fw_abc123" } });

    expect(onChange).toHaveBeenCalledWith("fw_abc123");
  });

  it("toggles the key between masked and visible", () => {
    render(<FireworksApiKeyField value="fw_secret" onChange={jest.fn()} />);

    const input = () => screen.getByPlaceholderText("fw_...") as HTMLInputElement;
    expect(input().type).toBe("password");

    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(input().type).toBe("text");

    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(input().type).toBe("password");
  });
});
