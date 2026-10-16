// Saved designs kept on the device while signed out (IndexedDB; jsdom has none, so the memory fallback runs here).
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RECIPE } from "./config";
import { clearDevice, listDevice, MAX_DEVICE, removeDevice, saveDevice } from "./history";

const design = (from: number) => ({ ...structuredClone(DEFAULT_RECIPE), surah: 2, from, to: from });
const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });

beforeEach(() => clearDevice());

describe("device history", () => {
  it("newest first; the same design is updated (time, thumbnail), a link never replaces a video", async () => {
    const a = await saveDevice({ recipe: design(1), title: "A", kind: "video", thumb: null }, 1000);
    await saveDevice({ recipe: design(2), title: "B", kind: "image", thumb: jpeg }, 2000);
    expect((await listDevice()).map((d) => d.title)).toEqual(["B", "A"]);
    // The same recipe written differently (missing newer fields) is the same design. (A missing effect reads as Solid,
    // not as the Shade new designs start with, so it is not left out here.)
    const { textX: _x, ...older } = design(1);
    const again = await saveDevice({ recipe: older as never, title: "A", kind: "link", thumb: jpeg }, 3000);
    expect(again).toMatchObject({ id: a.id, kind: "video", created_at: 1000, updated_at: 3000, thumb: jpeg });
    expect((await listDevice()).map((d) => d.title)).toEqual(["A", "B"]);
    expect((await saveDevice({ recipe: design(1), title: "A", kind: "image", thumb: null }, 4000)).kind).toBe("image");
    await removeDevice(a.id);
    expect((await listDevice()).map((d) => d.title)).toEqual(["B"]);
  });

  it("an older design (the removed typewriter, no Auto contrast switch) is kept and read in the current form", async () => {
    const { autoContrast: _a, ...older } = { ...design(5), animation: "typewriter" };
    await saveDevice({ recipe: older as never, title: "Old", kind: "video", thumb: null }, 1000);
    const [d] = await listDevice();
    expect(d.recipe).toMatchObject({ animation: "fade", autoContrast: true, from: 5 });
  });

  it(`keeps the newest ${MAX_DEVICE}`, async () => {
    for (let i = 1; i <= MAX_DEVICE + 3; i++) await saveDevice({ recipe: design(i), title: `#${i}`, kind: "image", thumb: null }, i);
    const list = await listDevice();
    expect(list).toHaveLength(MAX_DEVICE);
    expect(list[0].title).toBe(`#${MAX_DEVICE + 3}`);
    expect(list.at(-1)!.title).toBe("#4");
  });
});
