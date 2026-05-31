/**
 * Smoke test for /queue (#763). The page is a 3-line shell mounting
 * <QueueStatus/>; the child is stubbed.
 */
import { render, screen } from "@testing-library/react";

jest.mock("@/components/QueueStatus", () => ({
  __esModule: true,
  default: () => <div data-testid="queue-status">stub</div>,
}));

import QueuePage from "@/app/queue/page";

describe("/queue page", () => {
  it("renders QueueStatus inside the wrapper", () => {
    const { container } = render(<QueuePage />);
    expect(screen.getByTestId("queue-status")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass("space-y-6");
  });
});
