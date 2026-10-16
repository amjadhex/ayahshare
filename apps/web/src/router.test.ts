import { beforeEach, describe, expect, it } from "vitest";
import { back, closeSheet, getRoute, initRouter, navigate, openSheet, viewFromLocation } from "./router";

const popped = () => new Promise<void>((resolve) => addEventListener("popstate", () => setTimeout(resolve, 0), { once: true }));

describe("router (History API)", () => {
  beforeEach(() => {
    history.replaceState(null, "", "/");
    initRouter();
  });

  it("a share link opens Create with Find underneath", async () => {
    history.replaceState(null, "", "/s/abc123");
    initRouter();
    expect(getRoute()).toMatchObject({ view: "create", depth: 1 });
    expect(location.pathname).toBe("/s/abc123");
    const p = popped();
    back();
    await p;
    expect(getRoute().view).toBe("find");
    expect(location.pathname).toBe("/app");
  });

  it("back closes the sheet first, then returns Create → Find", async () => {
    navigate("create");
    expect(location.pathname).toBe("/create");
    openSheet("background");
    expect(getRoute()).toMatchObject({ view: "create", sheet: "background" });

    let p = popped();
    history.back();
    await p;
    expect(getRoute()).toMatchObject({ view: "create", sheet: null });

    p = popped();
    history.back();
    await p;
    expect(getRoute()).toMatchObject({ view: "find", sheet: null, depth: 0 });
  });

  it("closeSheet goes back once even when asked twice; switching sheets replaces the entry", async () => {
    navigate("create");
    openSheet("text");
    openSheet("style");
    expect(getRoute().sheet).toBe("style");
    const p = popped();
    closeSheet();
    closeSheet();
    await p;
    await new Promise((r) => setTimeout(r, 50));
    expect(getRoute()).toMatchObject({ view: "create", sheet: null });
  });

  it("a stacked sheet (a picker inside Preferences) gets its own entry: closing it leaves the sheet under it open", async () => {
    navigate("profile");
    openSheet("prefs");
    expect(getRoute()).toMatchObject({ sheet: "prefs", depth: 2 });
    openSheet("picker", true);
    expect(getRoute()).toMatchObject({ sheet: "picker", depth: 3 });
    const p = popped();
    closeSheet();
    await p;
    expect(getRoute()).toMatchObject({ view: "profile", sheet: "prefs", depth: 2 });
    const q = popped();
    closeSheet();
    await q;
    expect(getRoute()).toMatchObject({ view: "profile", sheet: null, depth: 1 });
  });

  it("Find from deeper screens goes back to the first entry", async () => {
    navigate("profile");
    navigate("create");
    expect(getRoute().depth).toBe(2);
    const p = popped();
    navigate("find");
    await p;
    expect(getRoute()).toMatchObject({ view: "find", depth: 0 });
  });
});

describe("router: redesign screens and old addresses", () => {
  it("opens old addresses on their new screens", () => {
    expect(viewFromLocation({ pathname: "/saved", search: "" } as Location)).toBe("profile");
    expect(viewFromLocation({ pathname: "/account", search: "" } as Location)).toBe("profile");
    expect(viewFromLocation({ pathname: "/reels", search: "" } as Location)).toBe("feed");
    expect(viewFromLocation({ pathname: "/create/share", search: "" } as Location)).toBe("share");
    expect(viewFromLocation({ pathname: "/s/abc123", search: "" } as Location)).toBe("create");
  });
});
