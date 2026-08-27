/**
 * Smoke test for /settings (#763). The page is a short shell that mounts
 * <LanAccessCard/> and <NotificationSettings/>; we stub the children to
 * probes and assert the wrapper renders them.
 */
import { render, screen } from "@testing-library/react";

jest.mock("@/components/NotificationSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="notification-settings">stub</div>,
}));

jest.mock("@/components/LanAccessCard", () => ({
  __esModule: true,
  default: () => <div data-testid="lan-access-card">stub</div>,
}));

import SettingsPage from "@/app/settings/page";

describe("/settings page", () => {
  it("renders its children inside the wrapper", () => {
    const { container } = render(<SettingsPage />);
    expect(screen.getByTestId("notification-settings")).toBeInTheDocument();
    expect(screen.getByTestId("lan-access-card")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass("space-y-6");
  });
});
