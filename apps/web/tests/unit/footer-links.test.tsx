/**
 * Unit test for Footer component — verifies links point to the correct URLs.
 */
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import Footer from "@/components/Footer";

const BLOG_URL = "https://brlauuu.github.io";

describe("Footer brlauuu links", () => {
  beforeEach(() => {
    // Footer fires /api/version on mount (#744). Stub so this suite
    // stays focused on link wiring.
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ built_in: null, on_disk: null }),
      } as unknown as Response),
    ) as unknown as typeof fetch;
    render(<Footer />);
  });

  test("copyright brlauuu link points to GitHub Pages blog", () => {
    const copyrightLink = screen.getByRole("link", { name: "brlauuu" });
    expect(copyrightLink).toHaveAttribute("href", BLOG_URL);
  });

  test("O'Saasy License link points to osaasy.dev", () => {
    const licenseLink = screen.getByRole("link", { name: "O'Saasy License" });
    expect(licenseLink).toHaveAttribute("href", "https://osaasy.dev");
  });

  test("About link was moved to Navbar", () => {
    const aboutLink = screen.queryByRole("link", { name: "About" });
    expect(aboutLink).toBeNull();
  });
});
