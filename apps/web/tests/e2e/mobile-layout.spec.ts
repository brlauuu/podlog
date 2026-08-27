import { test, expect } from "@playwright/test";

/**
 * Mobile layout guards (#989).
 *
 * The app was laid out for a desktop window: 44 breakpoint-prefixed
 * utilities across the whole of src/, and Navbar / QueueStatus /
 * EpisodeCard / AudioPlayer between them had none. What worked on a phone
 * worked because flex-wrap is forgiving, not because anyone chose it.
 *
 * These are the two things worth asserting mechanically, because both are
 * objective and neither needs a human to look at a screenshot:
 *
 *   1. The page does not scroll horizontally. This is the clearest single
 *      signal that something overflows its container.
 *   2. The sticky navbar does not eat the viewport. It is on every page, so
 *      when it wraps to four rows it costs the same on all of them.
 *
 * Deliberately NOT screenshot comparisons: those fail on every intentional
 * copy change and get regenerated without being read, which trains people
 * to ignore them.
 *
 * These run in the nightly Playwright suite (ci-slow.yml), not on PRs --
 * jsdom has no layout engine, so a real browser is the only way to measure
 * this at all, and the fast PR workflow is deliberately kept fast.
 */

const VIEWPORTS = [
  { name: "iPhone 14 (390px)", width: 390, height: 844 },
  { name: "small Android (360px)", width: 360, height: 800 },
];

// Public pages that render without seeded data.
const PAGES = ["/", "/search", "/ask", "/queue", "/feeds", "/podcasts", "/settings", "/docs", "/about", "/meta-analysis"];

/**
 * Share of a 844px-tall viewport the sticky nav may occupy. The current
 * eight-link flex-wrap row lands around four rows at 390px; one row of
 * ~44px touch targets plus padding is comfortably under this.
 */
const MAX_NAV_FRACTION = 0.14;

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name}`, () => {
    // Viewport only: spreading a `devices` entry would set defaultBrowserType,
    // which Playwright refuses inside a describe (it forces a new worker).
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const path of PAGES) {
      test(`${path} does not scroll horizontally`, async ({ page }) => {
        const response = await page.goto(path);

        // A page that failed to render is trivially narrow enough. Without
        // this, running locally without DATABASE_URL turns every DB-backed
        // page into an error boundary and the whole suite goes green while
        // measuring nothing. Fail loudly instead.
        expect(
          response?.status(),
          `${path} did not render (is DATABASE_URL set? see fixtures/db.ts)`,
        ).toBe(200);

        // `.first()` because /docs also renders a table-of-contents <nav>.
        // Waiting on the site navbar doubles as the hydration barrier: much
        // of the app is client-rendered, so measuring at domcontentloaded
        // measures an empty shell.
        await expect(
          page.locator("nav").first(),
          `${path} rendered without a navbar, so the layout shell is missing`,
        ).toBeVisible({ timeout: 15_000 });
        await page.waitForLoadState("networkidle");

        const { scrollWidth, clientWidth, offender } = await page.evaluate(() => {
          const doc = document.documentElement;
          // Name the widest offending element so a failure is actionable
          // rather than just "something is too wide".
          let offender = "";
          let worst = doc.clientWidth;
          // Elements inside a horizontal scroller are SUPPOSED to be wider
          // than the viewport -- that is what the scroller is for. Counting
          // them buries the element that actually widens the page.
          const inScroller = (el: Element) => {
            let p: Element | null = el.parentElement;
            while (p && p !== document.body) {
              const ox = getComputedStyle(p).overflowX;
              if (ox === "auto" || ox === "scroll" || ox === "hidden") return true;
              p = p.parentElement;
            }
            return false;
          };
          for (const el of Array.from(document.body.querySelectorAll("*"))) {
            const r = el.getBoundingClientRect();
            if (r.right > worst + 1 && !inScroller(el)) {
              worst = r.right;
              offender = `${el.tagName.toLowerCase()}.${(el.className || "").toString().slice(0, 80)}`;
            }
          }
          return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, offender };
        });

        expect(
          scrollWidth,
          `page scrolls horizontally at ${vp.width}px; widest offender: ${offender || "unknown"}`,
        ).toBeLessThanOrEqual(clientWidth + 1);
      });
    }

    test("the sticky navbar does not eat the viewport", async ({ page }) => {
      await page.goto("/search");
      await page.waitForLoadState("domcontentloaded");

      const navHeight = await page.evaluate(() => {
        const nav = document.querySelector("nav");
        return nav ? nav.getBoundingClientRect().height : 0;
      });

      expect(navHeight).toBeGreaterThan(0);
      expect(
        navHeight,
        `sticky nav is ${navHeight}px tall at ${vp.width}px wide, ` +
          `${Math.round((navHeight / vp.height) * 100)}% of the viewport`,
      ).toBeLessThanOrEqual(vp.height * MAX_NAV_FRACTION);
    });
  });
}
