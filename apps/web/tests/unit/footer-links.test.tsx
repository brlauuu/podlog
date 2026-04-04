/**
 * Unit test for Footer component — verifies brlauuu links point to
 * the personal blog (GitHub Pages) per issue #25.
 */
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock TanStack React Query so Footer renders without a QueryClient
jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isLoading: true }),
}));

// Mock lucide-react icons
jest.mock("lucide-react", () => ({
  ExternalLink: () => <svg data-testid="external-link-icon" />,
}));

import Footer from "@/components/Footer";

const BLOG_URL = "https://brlauuu.github.io";

describe("Footer brlauuu links", () => {
  beforeEach(() => {
    render(<Footer />);
  });

  test("@brlauuu credits link points to GitHub Pages blog", () => {
    const link = screen.getByRole("link", { name: "@brlauuu" });
    expect(link).toHaveAttribute("href", BLOG_URL);
  });

  test("copyright brlauuu link points to GitHub Pages blog", () => {
    const copyrightLink = screen.getByRole("link", { name: "brlauuu" });
    expect(copyrightLink).toHaveAttribute("href", BLOG_URL);
  });

  test("brlauuu/podlog repo link still points to GitHub", () => {
    const repoLink = screen.getByRole("link", { name: "brlauuu/podlog" });
    expect(repoLink).toHaveAttribute(
      "href",
      "https://github.com/brlauuu/podlog"
    );
  });
});
