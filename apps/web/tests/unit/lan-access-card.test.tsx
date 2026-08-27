/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

import LanAccessCard from "@/components/LanAccessCard";

function mockAddress(url: string | null, source: string | null = "host") {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ url, source }),
  })) as unknown as typeof fetch;
}

describe("LanAccessCard (#1012)", () => {
  it("shows the address so it can be typed into a phone", async () => {
    mockAddress("http://192.168.1.190:3000");
    render(<LanAccessCard />);
    await waitFor(() =>
      expect(screen.getByText("http://192.168.1.190:3000")).toBeInTheDocument()
    );
  });

  it("warns that reaching the address means full control", async () => {
    // The whole reason #988 exists. Advertising the address more prominently
    // without this would be a step backwards.
    mockAddress("http://192.168.1.190:3000");
    render(<LanAccessCard />);
    await waitFor(() => expect(screen.getByText(/no login/i)).toBeInTheDocument());
    expect(screen.getByText(/full control/i)).toBeInTheDocument();
  });

  it("says the address may change rather than implying it is fixed", async () => {
    mockAddress("http://192.168.1.190:3000");
    render(<LanAccessCard />);
    await waitFor(() => expect(screen.getByText(/can change/i)).toBeInTheDocument());
  });

  it("renders nothing at all when there is no address to show", async () => {
    // Loopback-only install. An empty card headed "Access from another
    // device" would be a puzzle, not information.
    mockAddress(null, null);
    const { container } = render(<LanAccessCard />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the request fails", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const { container } = render(<LanAccessCard />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
