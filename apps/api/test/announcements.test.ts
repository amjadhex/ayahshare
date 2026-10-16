// News from AyahShare: written on the admin's Announcements page, read by the app's Notifications.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { parseLink } from "../src/routes/announcements";
import { call, send } from "./helpers";

const ADMIN = { Authorization: "Bearer test-admin" };
const post = (body: unknown) => send("POST", "/admin/api/announcements", body, { headers: ADMIN });

describe("announcements", () => {
  it("the admin writes one; everyone reads the newest 5 from the last 60 days, cached for five minutes", async () => {
    const res = await post({ title: "  21 more reciters  ", body: "Pick one in Language and audio.", link: "/feed" });
    expect(res.status).toBe(201);
    const made = await res.json<any>();
    expect(made).toMatchObject({ title: "21 more reciters", body: "Pick one in Language and audio.", link: "/feed" });
    for (let i = 1; i <= 5; i++) await post({ title: `News ${i}` });
    await env.DB.prepare("INSERT INTO announcements (title, body, created_at) VALUES ('Old news', '', ?)").bind(Date.now() - 61 * 86400_000).run();

    const pub = await call("/api/announcements");
    expect(pub.status).toBe(200);
    expect(pub.headers.get("Cache-Control")).toBe("public, max-age=300");
    const { items } = await pub.json<any>();
    expect(items.map((a: any) => a.title)).toEqual(["News 5", "News 4", "News 3", "News 2", "News 1"]);
    expect(items[0]).toEqual({ id: expect.any(Number), title: "News 5", body: "", link: null, at: expect.any(Number) });

    const all = await (await call("/admin/api/announcements", { headers: ADMIN })).json<any>();
    expect(all.items.map((a: any) => a.title)).toContain("Old news");
    expect((await send("DELETE", `/admin/api/announcements/${made.id}`, undefined, { headers: ADMIN })).status).toBe(204);
    const after = await (await call("/admin/api/announcements", { headers: ADMIN })).json<any>();
    expect(after.items.map((a: any) => a.id)).not.toContain(made.id);
  });

  it("needs the admin guard to write, and checks what is written", async () => {
    expect((await send("POST", "/admin/api/announcements", { title: "x" })).status).toBe(401);
    expect((await send("DELETE", "/admin/api/announcements/1")).status).toBe(401);
    expect((await post({ title: "" })).status).toBe(400);
    expect((await post({ title: "x".repeat(81) })).status).toBe(400);
    expect((await post({ title: "ok", body: "x".repeat(281) })).status).toBe(400);
    expect((await post({ title: "ok", link: "javascript:alert(1)" })).status).toBe(400);
    expect((await send("DELETE", "/admin/api/announcements/abc", undefined, { headers: ADMIN })).status).toBe(400);
  });

  it("a link is an app path or an https address", () => {
    expect(parseLink("/discover")).toBe("/discover");
    expect(parseLink("/s/abc123")).toBe("/s/abc123");
    expect(parseLink("https://ayahshare.com/support")).toBe("https://ayahshare.com/support");
    expect(parseLink("")).toBeNull();
    expect(parseLink(null)).toBeNull();
    for (const bad of ["//evil.com", "http://ayahshare.com", "javascript:alert(1)", "discover", "/a b", 5]) expect(parseLink(bad), String(bad)).toBeUndefined();
  });
});
