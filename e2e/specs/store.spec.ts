import { test, expect } from "@playwright/test";
import { registerViaUi, uniqueUser } from "../helpers/session";

// Store tab from 09 Phase-7: the flavor page renders "Coming soon…" (00
// product inventory; 05's route table).

test("Store tab renders the Coming soon… flavor page", async ({ page }) => {
  const user = uniqueUser();
  await registerViaUi(page, user);

  await page.getByTestId("tab-store").click();
  await page.waitForURL("**/store");
  await expect(page.getByRole("heading", { name: "Store" })).toBeVisible();
  await expect(page.locator(".store-soon")).toHaveText("Coming soon…");
});
