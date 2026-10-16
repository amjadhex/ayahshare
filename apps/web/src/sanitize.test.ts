import { expect, it } from "vitest";
import { safeHtml } from "./sanitize";

it("tafsir HTML keeps basic formatting with lang/dir only", () => {
  const html = safeHtml(`<h2 onclick="x()">Title</h2><p style="color:red" lang="ur" dir="rtl">Text <a href="javascript:alert(1)">link</a>`
    + `<img src=x onerror=alert(1)><script>alert(2)</script><iframe src="https://x"></iframe><span lang="bad value">s</span></p>`);
  expect(html).toBe('<h2>Title</h2><p lang="ur" dir="rtl">Text link<span>s</span></p>');
});

it("keeps the Worker's layout classes and drops every other class", () => {
  const html = safeHtml('<div class="rf-q evil"><p class="rf-ar" lang="ar" dir="rtl">x</p><p class="rf-tr">t</p></div>'
    + '<span class="rf-mark constructor __proto__">[1]</span><p class="toString">y</p>');
  expect(html).toBe('<div class="rf-q"><p lang="ar" dir="rtl" class="rf-ar">x</p><p class="rf-tr">t</p></div><span class="rf-mark">[1]</span><p>y</p>');
});
