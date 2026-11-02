import { expect, test, type Page } from "@playwright/test";
import { installFakeClaude, type FakeClaudeRecord } from "./fake-claude";

// The standalone build (standalone/dist, built by `npm run build:standalone`) driven through its real interface.
// preview.html is index.html inside the document skeleton the artifact platform wraps it in.

const PAGE = "/preview.html";

/** Fail on uncaught exceptions and on anything logged as an error (React logs a crashed render there). */
function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  return errors;
}

const persistenceStatus = (page: Page) =>
  page.evaluate(() => (globalThis as { __MU_PERSISTENCE__?: { status(): { mode: string; saving: boolean } } }).__MU_PERSISTENCE__?.status());

/** The "What is mathematics?" check, answered correctly (the free-text question through the self-check). */
async function passWhatIsMathematics(page: Page) {
  await page.locator("#assessment").scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Start the check" }).click();
  const answered = new Set<string>();
  for (let i = 0; i < 5; i++) {
    await expect(page.getByText(/Question \d of 5/)).toBeVisible();
    const prompt = (await page.locator("#assessment .prose-math").first().textContent()) ?? "";
    if (/best describes/.test(prompt)) {
      await page.getByText("The careful study of quantity, pattern, structure").click();
      await page.getByRole("button", { name: "Check" }).click();
    } else if (/involve mathematical thinking/.test(prompt)) {
      await page.getByText("Working out whether 20 chairs").click();
      await page.getByText("Noticing that the house numbers").click();
      await page.getByText("Being certain that a staircase").click();
      await page.getByRole("button", { name: "Check" }).click();
    } else if (/only about calculating/.test(prompt)) {
      await page.getByRole("button", { name: "False" }).click();
    } else if (/step 5 have/.test(prompt)) {
      await page.getByLabel("Your answer").fill("5");
      await page.getByRole("button", { name: "Check" }).click();
    } else if (/own words/.test(prompt)) {
      await page.getByLabel("Your explanation").fill("Mathematics is the precise study of quantity, patterns and shapes, and reasoning about what must be true.");
      await page.getByRole("button", { name: "Submit explanation" }).click();
      // No AI here, so the learner checks their answer against the key ideas.
      const boxes = page.locator("fieldset").filter({ hasText: "key ideas" }).getByRole("checkbox");
      await expect(boxes.first()).toBeVisible();
      for (let k = 0; k < (await boxes.count()); k++) await boxes.nth(k).check();
      await page.getByRole("button", { name: "Submit my self-check" }).click();
    } else {
      throw new Error(`unexpected question: ${prompt}`);
    }
    await expect(page.locator("#assessment").getByRole("status").last()).toBeVisible();
    answered.add(prompt);
    if (i < 4) await page.getByRole("button", { name: "Next question →" }).click();
  }
  expect(answered.size).toBe(5);
  await page.getByRole("button", { name: "See my result" }).click();
  await expect(page.getByText(/Well done - 100%/)).toBeVisible();
}

test.describe("opened outside claude.ai (no window.claude)", () => {
  test("a lesson is learned and passed, and the progress survives a reload", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(PAGE);
    await expect(page.getByRole("heading", { name: /first question/i })).toBeVisible();
    await page.getByRole("link", { name: /Start the first lesson/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "What is mathematics?" })).toBeVisible();
    await expect(page).toHaveURL(/#v-learn--l0-what-is-mathematics$/);
    await expect(page.getByText(/words? (was|were) added to your dictionary/)).toBeVisible();

    // The lesson's own anchors scroll the page and leave the route in the URL alone.
    await page.getByRole("navigation", { name: "Lesson sections" }).getByRole("link", { name: "Check your understanding" }).click();
    await expect(page.locator("#assessment")).toBeInViewport();
    await expect(page).toHaveURL(/#v-learn--l0-what-is-mathematics$/);

    await passWhatIsMathematics(page);
    expect((await persistenceStatus(page))?.mode).toBe("browser");
    await expect.poll(async () => (await persistenceStatus(page))?.saving, { timeout: 10_000 }).toBe(false);

    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "What is mathematics?" })).toBeVisible();
    await expect(page.locator("article > header").getByText("Understood", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Progress", exact: true }).click();
    await expect(page).toHaveURL(/#v-progress$/);
    await expect(page.getByText("Everything here is saved in this browser only and kept between sessions.")).toBeVisible();
    await expect(page.getByRole("link", { name: "What is mathematics?" })).toBeVisible();
    await expect(page.getByText(/Passed the check for "What is mathematics\?" \(100%\)/)).toBeVisible();

    await page.getByRole("link", { name: "Home", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Why did humans invent mathematics?" })).toBeVisible();

    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page.getByText(/saved in this browser only/)).toBeVisible();
    await expect(page.getByText("switched off", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("back, forward and links into a page follow the route in the hash", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(`${PAGE}#v-map--target--pb-research`);
    await expect(page.getByText(/The path to Research-level analytic number theory, as a list/)).toBeVisible();
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page).toHaveURL(/#v-map$/);

    await page.getByRole("link", { name: "My dictionary", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "My mathematical dictionary" })).toBeVisible();
    await expect(page).toHaveURL(/#v-dictionary$/);
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: "Knowledge map" })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole("heading", { level: 1, name: "My mathematical dictionary" })).toBeVisible();

    // A hash that is not a route (an in-page anchor) does not change the page.
    await page.evaluate(() => (location.hash = "#somewhere"));
    await page.waitForTimeout(200);
    await expect(page.getByRole("heading", { level: 1, name: "My mathematical dictionary" })).toBeVisible();

    // An edited artifact link opens that page directly.
    await page.evaluate(() => (location.hash = "#v-dictionary--denominator"));
    await expect(page.getByRole("heading", { name: "denominator" }).first()).toBeVisible();
    await page.goto(`${PAGE}#v-no-such-page`);
    await expect(page.getByRole("heading", { name: "There is nothing here" })).toBeVisible();
    await page.getByRole("link", { name: "Go to the home page" }).click();
    await expect(page.getByRole("heading", { name: /first question/i })).toBeVisible();
    await expect(page).toHaveURL(/#v-home$/);
    expect(errors).toEqual([]);
  });
});

const REPLY = {
  reply: "A pattern is something that repeats in a predictable way. (scripted tutor reply 7Q)",
  strategy: "plain-language",
  check_question: "What number comes after 2, 4 and 6 in this pattern?",
  missing_prerequisites: [],
  new_terms: [],
  statements: [],
};

test.describe("inside claude.ai (fake window.claude)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(installFakeClaude, { reply: REPLY, userId: "u1" });
  });

  const record = (page: Page) => page.evaluate(() => (window as unknown as { __fakeClaude: FakeClaudeRecord }).__fakeClaude);

  test("progress is saved to the Claude account, backups are offered as files, and the tutor answers", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(`${PAGE}#v-settings`);
    await expect(page.getByText(/saved privately to your Claude account/)).toBeVisible();
    await expect(page.getByText("switched on", { exact: true })).toBeVisible();
    expect((await persistenceStatus(page))?.mode).toBe("account");

    await page.getByRole("button", { name: "Download a backup" }).click();
    await expect(page.getByText("Backup saved.")).toBeVisible();
    const [backup] = (await record(page)).downloads;
    expect(backup.filename).toMatch(/^mathematical-universe-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(typeof JSON.parse(backup.data)).toBe("object");

    await page.getByRole("link", { name: "Tutor", exact: true }).click();
    await expect(page).toHaveURL(/#v-tutor$/);
    await page.getByLabel("Message to the tutor").fill("What is a pattern?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(REPLY.reply)).toBeVisible();
    await expect(page.getByText(REPLY.check_question)).toBeVisible();
    expect((await record(page)).prompts.some((p) => p.includes("What is a pattern?"))).toBe(true);

    // The conversation is part of the learner's record, saved under their private collection.
    await expect.poll(async () => (await persistenceStatus(page))?.saving, { timeout: 10_000 }).toBe(false);
    const saved = Object.keys((await record(page)).docs);
    expect(saved.length).toBeGreaterThan(0);
    expect(saved.every((p) => p.startsWith("data/users/u1/"))).toBe(true);

    // ...and comes back from the account after a reload.
    await page.reload();
    await page.getByRole("button", { name: "What is a pattern?" }).click();
    await expect(page.getByText(REPLY.reply)).toBeVisible();
    expect((await persistenceStatus(page))?.mode).toBe("account");
    expect(errors).toEqual([]);
  });
});

const ROUTES: [hash: string, heading: string | RegExp][] = [
  ["", /first question/i],
  ["#v-home", /first question/i],
  ["#v-learn", "The curriculum"],
  ["#v-learn--l0-what-is-mathematics", "What is mathematics?"],
  ["#v-learn--pb-critical-line", "The critical line"],
  ["#v-dictionary", "My mathematical dictionary"],
  ["#v-dictionary--mathematics", "mathematics"],
  ["#v-map", "Knowledge map"],
  ["#v-map--target--pa-research", "Knowledge map"],
  ["#v-playground", "The playground"],
  ["#v-practice", "Practice"],
  ["#v-tutor", "Your tutor"],
  ["#v-progress", "My progress"],
  ["#v-research", "The research destinations"],
  ["#v-settings", "Settings"],
  ["#v-no-such-page", "There is nothing here"],
];

for (const [label, viewport] of [
  ["desktop", { width: 1280, height: 800 }],
  ["phone", { width: 390, height: 844 }],
] as const) {
  test.describe(`every page loads (${label}, ${viewport.width}px)`, () => {
    test.use({ viewport });
    for (const [hash, heading] of ROUTES) {
      test(hash || "(no hash)", async ({ page }) => {
        const errors = collectErrors(page);
        await page.goto(`${PAGE}${hash}`);
        await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
        await expect(page.getByText(/Loading/)).toHaveCount(0);
        if (viewport.width < 400) {
          const [scrollWidth, width] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
          expect(scrollWidth, "no horizontal scrolling").toBeLessThanOrEqual(width);
        }
        expect(errors).toEqual([]);
      });
    }
  });
}
