/**
 * Unit test for Footer component — verifies links point to the correct URLs.
 */
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import Footer from "@/components/Footer";

const BLOG_URL = "https://brlauuu.github.io";

describe("Footer brlauuu links", () => {
  beforeEach(() => {
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
