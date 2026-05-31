/**
 * Smoke test for /settings (#763). The page is a 3-line shell that mounts
 * <NotificationSettings/>; we stub the child to a probe and assert the
 * wrapper renders it.
 */
import { render, screen } from "@testing-library/react";

jest.mock("@/components/NotificationSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="notification-settings">stub</div>,
}));

import SettingsPage from "@/app/settings/page";

describe("/settings page", () => {
  it("renders NotificationSettings inside the wrapper", () => {
    const { container } = render(<SettingsPage />);
    expect(screen.getByTestId("notification-settings")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass("space-y-6");
  });
});
