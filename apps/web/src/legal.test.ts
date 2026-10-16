// The privacy notice, the terms, help and support, and the account-deletion steps are served as static pages
// (/privacy, /terms, /support, /delete-account) from public/; their source of truth
// is legal/ at the repo root. This fails when a copy falls behind its source.
import { expect, it } from "vitest";
import privacy from "../../../legal/privacy.html?raw";
import terms from "../../../legal/terms.html?raw";
import support from "../../../legal/support.html?raw";
import deleteAccount from "../../../legal/delete-account.html?raw";
import privacyCopy from "../public/privacy.html?raw";
import termsCopy from "../public/terms.html?raw";
import supportCopy from "../public/support.html?raw";
import deleteAccountCopy from "../public/delete-account.html?raw";

it("public/privacy.html, terms.html, support.html and delete-account.html are copies of legal/", () => {
  for (const [copy, source] of [[privacyCopy, privacy], [termsCopy, terms], [supportCopy, support], [deleteAccountCopy, deleteAccount]]) {
    expect(copy).toBe(source);
    expect(copy).toContain("AyahShare");
    expect(copy).not.toMatch(/quran\.design/i);
  }
});
