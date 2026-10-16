// Admin Library (owner, 15 Oct 2026): tafsirs, reciters and translation voices the admin turns off are no longer offered
// (GET /api/config `off`, the tafsir routes leave them out).
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { RECITERS } from "../../../contracts/reciters";
import { call, send } from "./helpers";

const ADMIN = { Authorization: "Bearer test-admin" };
const setOff = (kind: string, id: string, off: unknown) => send("PUT", `/admin/api/library/${kind}/${encodeURIComponent(id)}`, { off }, { headers: ADMIN });
const config = async () => (await (await call("/api/config")).json<any>()).off;

describe("library", () => {
  it("lists everything, marks what is off, and the app follows", async () => {
    const lib = await (await call("/admin/api/library", { headers: ADMIN })).json<any>();
    expect(lib.reciters).toHaveLength(RECITERS.length);
    expect(lib.voices.find((v: any) => v.id === "ml.lalithasaram")).toMatchObject({ lang: "ml", off: false });
    expect(lib.tafsirs.find((t: any) => t.id === "ml.amani")).toMatchObject({ lang: "ml", off: false });

    expect((await setOff("tafsir", "ml.thafheem", true)).status).toBe(204);
    expect((await setOff("reciter", "Alafasy_128kbps", true)).status).toBe(204);
    expect((await setOff("voice", "ml.lalithasaram", true)).status).toBe(204);
    expect(await config()).toEqual({ tafsirs: ["ml.thafheem"], reciters: ["Alafasy_128kbps"], voices: ["ml.lalithasaram"] });

    const listed = (await (await call("/api/tafsirs")).json<any>()).tafsirs.map((t: any) => t.id);
    expect(listed).not.toContain("ml.thafheem");
    expect(listed).toContain("ml.amani");
    await env.MEDIA.put("tafsir/ml.amani/v1/2.json", JSON.stringify({ surah: 2, ayahs: [{ ayah: 153, text: "Made-up text." }] }));
    // Malayalam's default (Thafheem) is off: the next one, even when asked for by id.
    const tafsir = await (await call("/api/tafsir/2:153?lang=ml&id=ml.thafheem")).json<any>();
    expect(tafsir.tafsir.id).toBe("ml.amani");
    expect(tafsir.options.map((o: any) => o.id)).not.toContain("ml.thafheem");

    const after = await (await call("/admin/api/library", { headers: ADMIN })).json<any>();
    expect(after.reciters.find((r: any) => r.id === "Alafasy_128kbps").off).toBe(true);

    expect((await setOff("tafsir", "ml.thafheem", false)).status).toBe(204);
    expect((await config()).tafsirs).toEqual([]);
  });

  it("needs the admin guard, a known id, and keeps one reciter on", async () => {
    expect((await send("PUT", "/admin/api/library/reciter/Alafasy_128kbps", { off: true })).status).toBe(401);
    expect((await call("/admin/api/library")).status).toBe(401);
    expect((await setOff("reciter", "Nobody_128kbps", true)).status).toBe(400);
    expect((await setOff("colour", "x", true)).status).toBe(400);
    expect((await setOff("voice", "en.walk", "yes")).status).toBe(400);
    expect((await setOff("reciter", RECITERS[0][0], false)).status).toBe(204); // on again after the test above
    for (const [id] of RECITERS.slice(1)) expect((await setOff("reciter", id, true)).status).toBe(204);
    const last = await setOff("reciter", RECITERS[0][0], true);
    expect(last.status).toBe(400);
    expect((await config()).reciters).toHaveLength(RECITERS.length - 1);
  });
});
