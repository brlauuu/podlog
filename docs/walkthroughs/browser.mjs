// Browser half of the walkthrough recordings (#1039).
//
//   BASE_URL=http://localhost:3001 SCENARIO=install OUT=/tmp/wt \
//     node docs/walkthroughs/browser.mjs
//
// Uses the Playwright already installed for the web e2e tests. Records one
// WebM per scenario into OUT. Scenarios:
//   install  home, queue (warm-up banner), settings tabs, add the first feed
//            in Test mode, watch it through the queue, open the episode,
//            one search, one Ask question.
//   update   footer version, /about release notes, queue.
//   ask      only the Ask question (QUESTION), for a re-take.
//   probe    read-only pass over every page used above; for checking
//            selectors against a running install without changing it.
import { createRequire } from "node:module";
import { mkdirSync, renameSync } from "node:fs";
import path from "node:path";

const require = createRequire(path.resolve("apps/web/package.json"));
const { chromium } = require("playwright");

const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const SCENARIO = process.env.SCENARIO || "probe";
const OUT = process.env.OUT || "docs/walkthroughs/out";
const FEED_URL = process.env.FEED_URL || "https://feeds.npr.org/500005/podcast.xml";
const QUESTION = process.env.QUESTION || "What were the main news stories?";
const PACE = Number(process.env.PACE ?? 1); // 0 = no pauses (probe)
const QUEUE_LIMIT_MS = Number(process.env.QUEUE_LIMIT_MS ?? 20 * 60 * 1000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms * PACE));
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: SCENARIO === "probe" ? undefined : { dir: OUT, size: { width: 1280, height: 800 } },
  colorScheme: "light",
});
const page = await context.newPage();
const videoPath = page.video() ? await page.video().path() : null;

async function go(p, label, dwell = 4000) {
  log(`${label}: ${p}`);
  await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
  await sleep(dwell);
}

async function settingsTab(name) {
  const tab = page.getByRole("tab", { name }).first();
  if (await tab.count()) await tab.click();
  else await page.getByRole("button", { name, exact: true }).first().click();
  await sleep(3500);
}

async function install() {
  await go("/", "home, empty install", 5000);
  await go("/queue", "queue page during warm-up", 6000);
  await go("/settings", "settings", 3000);
  for (const t of ["Inference", "Notifications", "Prompts", "Backups"]) {
    log(`settings tab ${t}`);
    await settingsTab(t);
  }
  await go("/podcasts", "sources, empty", 3000);
  await go("/feeds", "feeds page", 3000);
  await page.getByRole("button", { name: /Add Feed/ }).first().click();
  await sleep(1500);
  await page.getByPlaceholder("https://feeds.example.com/podcast.xml").fill(FEED_URL);
  await sleep(1500);
  await page.getByRole("button", { name: /^Test/ }).click();
  await sleep(1500);
  await page.getByRole("button", { name: /^Add$/ }).click();
  await sleep(3000);
  log("feed added; watching the queue");
  await go("/queue", "queue with the first episode", 5000);
  const started = Date.now();
  while (Date.now() - started < QUEUE_LIMIT_MS) {
    await page.reload({ waitUntil: "networkidle" });
    await sleep(8000);
    const text = await page.locator("body").innerText();
    if (/No episodes in the queue|Done/.test(text) && !/Pending|Downloading|Transcribing|Diarizing|Chunking|Embedding|Inferring|Archiving/.test(text)) break;
  }
  await go("/podcasts", "sources with one podcast", 4000);
  const episode = page.locator("a[href^='/episodes/']").first();
  if (await episode.count()) {
    await episode.click();
    await page.waitForLoadState("networkidle");
    await sleep(6000);
    await page.mouse.wheel(0, 600);
    await sleep(4000);
  }
  await go("/search?q=news", "search", 6000);
  await go("/ask", "ask", 2000);
  await page.getByPlaceholder("Ask about your transcripts...").fill(QUESTION);
  await sleep(1000);
  await page.getByRole("button", { name: /ask|send/i }).first().click().catch(() => page.keyboard.press("Enter"));
  const askStart = Date.now();
  while (Date.now() - askStart < 4 * 60 * 1000) {
    await sleep(5000);
    const t = await page.locator("body").innerText();
    if (/Sources|Error|not available/i.test(t)) break;
  }
  await sleep(6000);
}

// Ask alone: used to re-take the Ask step when the first question found no
// excerpts (a five-minute news bulletin needs a specific question).
async function ask() {
  await go("/ask", "ask", 2000);
  await page.getByPlaceholder("Ask about your transcripts...").fill(QUESTION);
  await sleep(1000);
  await page.getByRole("button", { name: /ask|send/i }).first().click().catch(() => page.keyboard.press("Enter"));
  const askStart = Date.now();
  while (Date.now() - askStart < 4 * 60 * 1000) {
    await sleep(5000);
    const t = await page.locator("body").innerText();
    if (/Sources|Error|not available|No relevant/i.test(t)) break;
  }
  await sleep(8000);
}

async function update() {
  await go("/", "home after the update", 4000);
  await page.mouse.wheel(0, 2000);
  await sleep(3000);
  await go("/about", "about: version and release notes", 5000);
  await page.mouse.wheel(0, 900);
  await sleep(5000);
  await go("/queue", "queue after the update", 4000);
}

async function probe() {
  for (const p of ["/", "/queue", "/settings", "/podcasts", "/feeds", "/search?q=news", "/ask", "/about"]) {
    await go(p, "probe", 0);
    console.log(`  title: ${await page.title()}`);
  }
  await go("/settings", "probe tabs", 0);
  for (const t of ["Inference", "Notifications", "Prompts", "Backups"]) {
    const tabs = await page.getByRole("tab", { name: t }).count();
    const btns = await page.getByRole("button", { name: t, exact: true }).count();
    console.log(`  tab ${t}: role=tab ${tabs}, button ${btns}`);
  }
  await go("/feeds", "probe add feed", 0);
  console.log(`  Add Feed buttons: ${await page.getByRole("button", { name: /Add Feed/ }).count()}`);
  await go("/ask", "probe ask", 0);
  console.log(`  ask input: ${await page.getByPlaceholder("Ask about your transcripts...").count()}`);
}

try {
  if (SCENARIO === "install") await install();
  else if (SCENARIO === "update") await update();
  else if (SCENARIO === "ask") await ask();
  else await probe();
} finally {
  await context.close();
  await browser.close();
  if (SCENARIO !== "probe" && videoPath) {
    // Rename this page's own recording; never guess from a directory listing.
    const dest = path.join(OUT, `${SCENARIO}-browser.webm`);
    renameSync(videoPath, dest);
    log(`video: ${dest}`);
  }
}
