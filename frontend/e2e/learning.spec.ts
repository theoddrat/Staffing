import { expect, test, type Page } from "@playwright/test";

// The core learning loop, driven through the real interface.

async function noPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test("a new learner is pointed at the very first lesson", async ({ page }) => {
  const errors = await noPageErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /first question/i })).toBeVisible();
  await expect(page.getByText("What is mathematics?").first()).toBeVisible();
  await page.getByRole("link", { name: /Start the first lesson/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "What is mathematics?" })).toBeVisible();
  // Opening a lesson adds its words to the personal dictionary automatically.
  await expect(page.getByText(/words? (was|were) added to your dictionary/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("complete a lesson: read, open a word, ask for another explanation, pass the check", async ({ page }) => {
  const errors = await noPageErrors(page);
  await page.goto("/learn/l0-what-is-mathematics");
  await expect(page.getByRole("heading", { level: 1, name: "What is mathematics?" })).toBeVisible();

  // The dictionary drawer opens without leaving the page and shows all ten parts.
  await page.locator("#word").getByRole("button", { name: "mathematics" }).first().click();
  const drawer = page.getByRole("dialog", { name: "Dictionary entry" });
  await expect(drawer.getByText("Non-example (something it is not)")).toBeVisible();
  await expect(drawer.getByText("Where you will use it")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();

  // "I don't understand" brings a different teaching strategy.
  await page.getByRole("button", { name: "I don't understand" }).click();
  const help = page.getByRole("dialog", { name: "A different explanation" });
  await expect(help.getByText("Let's try a different way")).toBeVisible();
  await expect(help.locator("h3")).toHaveText(/./);
  await help.getByRole("button", { name: /back to the lesson/ }).click();

  // The check: answer every question correctly.
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
      // Without an AI provider, the learner checks their answer against the key ideas.
      const boxes = page.locator("fieldset").filter({ hasText: "key ideas" }).getByRole("checkbox");
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
  await expect(page.getByRole("link", { name: /Next: Why did humans invent mathematics/ })).toBeVisible();

  // Progress is persisted and reflected elsewhere.
  await page.goto("/progress");
  await expect(page.getByRole("link", { name: "What is mathematics?" })).toBeVisible();
  await expect(page.getByText(/Passed the check for "What is mathematics\?" \(100%\)/)).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Why did humans invent mathematics?" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a wrong answer gives a diagnosis and a second try", async ({ page }) => {
  await page.goto("/learn/l0-patterns");
  await page.locator("#assessment").scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Start the check" }).click();
  for (let i = 0; i < 5; i++) {
    const prompt = (await page.locator("#assessment .prose-math").first().textContent()) ?? "";
    if (/Triangles of dots/.test(prompt)) {
      await page.getByLabel("Your answer").fill("20");
      await page.getByRole("button", { name: "Check" }).click();
      await expect(page.getByText("Not quite - you have another try.")).toBeVisible();
      await expect(page.getByText(/differences grow by one each time/)).toBeVisible();
      await page.getByLabel("Your answer").fill("21");
      await page.getByRole("button", { name: "Check" }).click();
      await expect(page.getByText("Correct on the second try.")).toBeVisible();
      return;
    }
    await page.getByRole("button", { name: /Skip for now|Next question/ }).click();
  }
  throw new Error("triangle question not found");
});

test("planned lessons are shown honestly", async ({ page }) => {
  await page.goto("/learn/pb-critical-line");
  await expect(page.getByText("This lesson is planned but not written yet.")).toBeVisible();
  await expect(page.getByText("It builds on")).toBeVisible();
});

test("the knowledge map highlights the path to the Riemann Hypothesis", async ({ page }) => {
  await page.goto("/map");
  await page.getByRole("button", { name: "Riemann Hypothesis", exact: true }).click();
  await expect(page.getByText(/The path to Research-level analytic number theory, as a list/)).toBeVisible();
  await expect(page.getByRole("link", { name: "What is a number?" }).first()).toBeVisible();
});

test("dictionary search and playground tools work", async ({ page }) => {
  const errors = await noPageErrors(page);
  await page.goto("/dictionary");
  await page.getByLabel("Search the dictionary").fill("denominator");
  await page.getByRole("button", { name: /denominator/ }).first().click();
  await expect(page.getByRole("dialog", { name: "Dictionary entry" }).getByText("Precise definition")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/playground");
  const tools = page.locator('nav[aria-label="Tools"] button');
  const n = await tools.count();
  expect(n).toBe(25);
  for (let i = 0; i < n; i++) await tools.nth(i).click();
  // The sieve finds the primes up to 100.
  await page.getByRole("button", { name: "Sieve of Eratosthenes" }).click();
  for (const p of [2, 3, 5, 7]) await page.getByRole("button", { name: String(p), exact: true }).click();
  await expect(page.getByText(/The 25 numbers left are exactly the primes up to 100/)).toBeVisible();
  expect(errors).toEqual([]);
});
