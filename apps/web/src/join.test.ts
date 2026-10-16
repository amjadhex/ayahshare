// When the sign-up invitation shows: once per reason, at most one unasked a day, Log in always; never signed in.
import { beforeEach, describe, expect, it } from "vitest";
import { inviteToJoin, skipLanguage, toggleFavourite } from "./actions";
import { askToJoin, closeJoin, getJoin, nameAskDue, nameAsked, needsName, resetJoin } from "./join";
import { createStore, type Store } from "./state";

const DAY = 24 * 3600 * 1000;
const T0 = Date.UTC(2026, 9, 8, 12);

function store(googleClientId: string | null = "client-id", emailSignIn = false): Store {
  const s = createStore();
  s.dispatch({ type: "booted", config: { appName: "AyahShare", googleClientId, emailSignIn, mediaBase: "/media/" }, surahs: [], recipe: null });
  return s;
}

beforeEach(() => {
  localStorage.clear();
  resetJoin();
});

describe("join invitations", () => {
  it("asks each reason once per device, and at most one unasked invitation a day", () => {
    askToJoin("welcome", T0);
    expect(getJoin()).toBe("welcome");
    closeJoin();
    askToJoin("like", T0 + DAY / 2); // too soon after the welcome
    expect(getJoin()).toBeNull();
    askToJoin("like", T0 + DAY + 1);
    expect(getJoin()).toBe("like");
    closeJoin();
    askToJoin("like", T0 + 5 * DAY); // asked before
    askToJoin("welcome", T0 + 5 * DAY);
    expect(getJoin()).toBeNull();
    askToJoin("create", T0 + 5 * DAY);
    expect(getJoin()).toBe("create");
  });

  it("the name: asked of an account with neither a chosen nor a Google name, again at most once a day", () => {
    expect(needsName(null)).toBe(false);
    expect(needsName({ name: "", displayName: null })).toBe(true);
    expect(needsName({ name: "  ", displayName: " " })).toBe(true);
    expect(needsName({ name: "Amina", displayName: null })).toBe(false);
    expect(needsName({ name: "", displayName: "Amina" })).toBe(false);
    expect(nameAskDue(T0)).toBe(true); // never asked
    nameAsked(T0);
    expect(nameAskDue(T0 + DAY - 1)).toBe(false);
    expect(nameAskDue(T0 + DAY)).toBe(true);
    resetJoin();
    expect(nameAskDue(T0 + 1)).toBe(true);
  });

  it("is never asked when signed in, signed in before on this device, or where sign-in is not offered", () => {
    const s = store();
    s.dispatch({ type: "me", me: { id: "u1", name: "A", email: "a@example.com" } as never });
    inviteToJoin(s, "welcome");
    expect(getJoin()).toBeNull();

    localStorage.setItem("qd.signedIn", "1");
    inviteToJoin(store(), "welcome");
    expect(getJoin()).toBeNull();
    localStorage.removeItem("qd.signedIn");

    inviteToJoin(store(null), "welcome");
    expect(getJoin()).toBeNull();

    inviteToJoin(store(), "welcome");
    expect(getJoin()).toBe("welcome");
  });

  it("email sign-in alone (no Google) is a way to sign in too", () => {
    inviteToJoin(store(null, true), "welcome");
    expect(getJoin()).toBe("welcome");
  });

  it("comes after the first language question and after the first like, signed out", async () => {
    const s = store();
    s.dispatch({ type: "langPicker", open: "first" });
    skipLanguage(s);
    expect(getJoin()).toBe("welcome");
    closeJoin();

    resetJoin();
    await toggleFavourite(s, "94:5");
    expect(getJoin()).toBe("like");
    closeJoin();
    await toggleFavourite(s, "94:5"); // un-liking never asks
    expect(getJoin()).toBeNull();
  });
});
