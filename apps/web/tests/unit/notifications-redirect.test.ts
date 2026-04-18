/**
 * @jest-environment node
 */
const mockRedirect = jest.fn();
jest.mock("next/navigation", () => ({ redirect: mockRedirect }));

type PageModule = typeof import("@/app/notifications/page");
let NotificationsPage: PageModule["default"];

beforeAll(async () => {
  const mod: PageModule = await import("@/app/notifications/page");
  NotificationsPage = mod.default;
});

beforeEach(() => {
  mockRedirect.mockReset();
});

describe("/notifications page", () => {
  it("redirects to /settings", () => {
    NotificationsPage();
    expect(mockRedirect).toHaveBeenCalledWith("/settings");
    expect(mockRedirect).toHaveBeenCalledTimes(1);
  });
});
