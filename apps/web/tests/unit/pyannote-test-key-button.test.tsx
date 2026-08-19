import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PyannoteApiKeyField } from "@/components/RemoteInferencePyannoteParts";

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => mockFetch.mockReset());

function renderField(value: string | null = "my-key") {
  return render(<PyannoteApiKeyField value={value} onChange={jest.fn()} />);
}

describe("PyannoteApiKeyField — Test key button (#933)", () => {
  it("reports a valid key", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

    renderField();
    fireEvent.click(screen.getByRole("button", { name: /test key/i }));

    expect(await screen.findByText(/key is valid/i)).toBeInTheDocument();
  });

  it("surfaces the server's reason on failure rather than a generic message", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "pyannote.ai rejected this key" }),
    });

    renderField("bad-key");
    fireEvent.click(screen.getByRole("button", { name: /test key/i }));

    expect(await screen.findByText(/rejected this key/i)).toBeInTheDocument();
  });

  it("falls back to a generic message when the error body is unusable", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => {
        throw new SyntaxError("not json");
      },
    });

    renderField("bad-key");
    fireEvent.click(screen.getByRole("button", { name: /test key/i }));

    expect(await screen.findByText(/test failed/i)).toBeInTheDocument();
  });

  it("reports a network error without crashing", async () => {
    mockFetch.mockRejectedValue(new Error("offline"));

    renderField();
    fireEvent.click(screen.getByRole("button", { name: /test key/i }));

    expect(await screen.findByText(/network error/i)).toBeInTheDocument();
  });

  it("sends the typed value so a key can be checked before saving", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

    renderField("freshly-typed");
    fireEvent.click(screen.getByRole("button", { name: /test key/i }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      api_key: "freshly-typed",
    });
  });

  it("disables the button while the request is in flight", async () => {
    let release: (v: unknown) => void = () => {};
    mockFetch.mockReturnValue(new Promise((r) => (release = r)));

    renderField();
    const btn = screen.getByRole("button", { name: /test key/i });
    fireEvent.click(btn);

    expect(await screen.findByRole("button", { name: /testing/i })).toBeDisabled();
    release({ ok: true, json: async () => ({ ok: true }) });
  });
});
