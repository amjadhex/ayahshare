// Sign-in on the login page (screens/Login.tsx, EmailSignIn.tsx, NameForm.tsx): Google and the email code where the
// server offers them, the code in six boxes (typing moves on, Backspace and the arrows move back, paste or the phone's
// code suggestion fill all six, auto-submitted, cleared with a shake on an error), kind errors, Resend after 30 s, Use
// another email, the same steps after sign-in as Google (the app keeps its token), then back to where it was opened from
// (or ?next=), asking a nameless account for its name first. Every way in (the card, the sheet, Home's Log in) opens the
// page. The network is a stand-in.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicConfig, SignedIn } from "../../../../contracts/types";
import * as api from "../api";
import { askToJoin, getJoin, nameAskDue, resetJoin } from "../join";
import { platform } from "../platform";
import { getRoute, initRouter, navigate } from "../router";
import { createStore, type Store } from "../state";
import { t } from "../strings";
import type { TurnstileApi } from "../turnstile";
import { StoreContext, useRoute } from "./hooks";
import { JoinCard, JoinSheet } from "./Join";
import { Login } from "./screens/Login";

vi.mock("../analytics", () => ({ anon: "test-anon", flush: () => {}, newDevice: () => {}, track: () => {} }));
vi.mock("../api", async (original) => ({
  ...(await original<typeof import("../api")>()),
  startEmailSignIn: vi.fn(async () => ({ ok: true })),
  verifyEmailCode: vi.fn(),
  signInWithApple: vi.fn(),
  getFavourites: vi.fn(async () => []),
  setFavourite: vi.fn(async () => undefined),
  saveLang: vi.fn(async () => ({})),
  patchMe: vi.fn(async () => ({})),
}));

/** An email account that has chosen a name (the name step is tested on its own). */
const ME: SignedIn = { id: "u-email", name: "", displayName: "Amina", email: "amina@example.test", avatar: null, lang: null };
const NAMELESS: SignedIn = { ...ME, displayName: null };
const refused = (status: number, reason: string) => new api.AuthError(status, "/api/auth/email/x", reason);
let store: Store;

/** The login page as the app shows it: on screen while the route is /login. */
function Page() {
  const route = useRoute();
  return <Login active={route.view === "login"} />;
}
function mount(node: ReactNode, config: Partial<PublicConfig> = {}, path = "/login") {
  history.replaceState(null, "", path);
  initRouter();
  store = createStore();
  store.dispatch({ type: "booted", config: { appName: "AyahShare", googleClientId: null, emailSignIn: true, mediaBase: "/media/", ...config }, surahs: [], recipe: null });
  return render(<StoreContext.Provider value={store}>{node}</StoreContext.Provider>);
}
const group = () => screen.getByRole("group", { name: t.emailCodeLabel });
const boxes = () => within(group()).getAllByRole("textbox") as HTMLInputElement[];
const values = () => boxes().map((b) => b.value).join("");

/** Sends a code to `email` from the login page; → the first code box. */
async function sendCode(user: ReturnType<typeof userEvent.setup>, email = "amina@example.test") {
  const field = screen.getByLabelText(t.emailLabel);
  await user.type(field, `  ${email} `);
  await user.click(screen.getByRole("button", { name: t.emailSend }));
  await screen.findByRole("group", { name: t.emailCodeLabel });
  return boxes()[0];
}

beforeEach(() => {
  localStorage.clear();
  resetJoin();
  vi.mocked(api.startEmailSignIn).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(api.verifyEmailCode).mockReset().mockResolvedValue(ME);
  vi.mocked(api.patchMe).mockReset().mockResolvedValue({ ...NAMELESS, displayName: "Amina K" });
  vi.spyOn(platform.googleSignIn, "mount").mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the login page", () => {
  it("full screen: close, the mark, the title, one line, Google and the email field at once (where offered), the notices", () => {
    const { unmount, container } = mount(<Page />, { googleClientId: "client-id" });
    expect(screen.getByRole("heading", { level: 1, name: t.joinTitle })).toBeTruthy();
    expect(screen.getByText(t.loginSub)).toBeTruthy();
    expect(screen.getByRole("button", { name: t.close })).toBeTruthy();
    expect(container.querySelector(".home-mark")).not.toBeNull();
    expect(container.querySelector(".join-google")).not.toBeNull();
    expect(screen.getByText(t.emailOr)).toBeTruthy();
    expect(screen.getByLabelText(t.emailLabel)).toBeTruthy(); // no "Continue with email" step first
    expect(document.activeElement).not.toBe(screen.getByLabelText(t.emailLabel)); // no keyboard over Google on phones
    expect(screen.getByRole("link", { name: t.privacyPolicy }).getAttribute("href")).toBe("/privacy");
    expect(screen.getByRole("link", { name: t.termsOfService }).getAttribute("href")).toBe("/terms");
    unmount();

    const google = mount(<Page />, { googleClientId: "client-id", emailSignIn: false });
    expect(screen.queryByLabelText(t.emailLabel)).toBeNull();
    expect(screen.queryByText(t.emailOr)).toBeNull();
    expect(google.container.querySelector(".join-google")).not.toBeNull();
    google.unmount();

    const alone = mount(<Page />);
    expect(screen.getByLabelText(t.emailLabel)).toBeTruthy();
    expect(screen.queryByText(t.emailOr)).toBeNull();
    expect(alone.container.querySelector(".join-google")).toBeNull();
  });

  it("is empty while another screen shows (nothing mounted, no Google button)", () => {
    const { container } = mount(<Page />, { googleClientId: "client-id" }, "/profile");
    expect(container.innerHTML).toBe("");
  });

  it("Close goes back to where it was opened from", async () => {
    const user = userEvent.setup();
    mount(<Page />);
    expect(getRoute()).toMatchObject({ view: "login", depth: 1 });
    await user.click(screen.getByRole("button", { name: t.close }));
    await waitFor(() => expect(getRoute().view).toBe("find"));
  });

  it("opened while signed in, it returns at once (to ?next= when given)", async () => {
    history.replaceState(null, "", "/login?next=profile");
    initRouter();
    store = createStore();
    store.dispatch({ type: "booted", config: { appName: "AyahShare", googleClientId: null, emailSignIn: true, mediaBase: "/media/" }, surahs: [], recipe: null });
    store.dispatch({ type: "me", me: ME });
    render(<StoreContext.Provider value={store}><Page /></StoreContext.Provider>);
    await waitFor(() => expect(getRoute().view).toBe("profile"));
    expect(location.pathname).toBe("/profile");
    expect(getRoute().depth).toBe(1); // in place of /login: Back does not return to it
  });
});

describe("the email code", () => {
  it("sends a code, six numeric boxes (the first takes the phone's code suggestion), typing moves on and sends it, then returns", async () => {
    const user = userEvent.setup();
    mount(<Page />, { googleClientId: "client-id" });
    const first = await sendCode(user);
    expect(api.startEmailSignIn).toHaveBeenCalledWith("amina@example.test", undefined); // no bot check configured
    expect(screen.getByRole("status").textContent).toBe(t.emailSent("amina@example.test"));
    expect(group().getAttribute("aria-describedby")).toContain(screen.getByRole("status").id);
    expect(boxes()).toHaveLength(6);
    expect(boxes().map((b) => b.getAttribute("aria-label"))).toEqual([1, 2, 3, 4, 5, 6].map((n) => t.emailDigit(n)));
    expect(boxes().every((b) => b.getAttribute("inputmode") === "numeric")).toBe(true);
    expect(first.getAttribute("autocomplete")).toBe("one-time-code");
    expect(boxes().slice(1).every((b) => b.getAttribute("autocomplete") === "off")).toBe(true);
    expect(document.activeElement).toBe(first);

    await user.keyboard("12a34");
    expect(values()).toBe("1234");
    expect(document.activeElement).toBe(boxes()[4]);
    expect(api.verifyEmailCode).not.toHaveBeenCalled();
    await user.keyboard(" 56");
    await waitFor(() => expect(store.getState().me).toEqual(ME));
    expect(api.verifyEmailCode).toHaveBeenCalledTimes(1);
    expect(api.verifyEmailCode).toHaveBeenCalledWith("amina@example.test", "123456");
    expect(localStorage.getItem("qd.signedIn")).toBe("1"); // the same after-sign-in steps as Google
    expect(api.getFavourites).toHaveBeenCalled();
    await waitFor(() => expect(getRoute().view).toBe("find")); // back to where it was opened from
  });

  it("pasting the code from the email (with a space) into any box fills all six and signs in", async () => {
    const user = userEvent.setup();
    mount(<Page />);
    await sendCode(user);
    await user.click(boxes()[3]);
    await user.paste("123 456");
    await waitFor(() => expect(api.verifyEmailCode).toHaveBeenCalledWith("amina@example.test", "123456"));
    await waitFor(() => expect(store.getState().me?.id).toBe("u-email"));
  });

  it("the phone's code suggestion (the whole code in the first box) fills all six", async () => {
    const user = userEvent.setup();
    mount(<Page />);
    const first = await sendCode(user);
    fireEvent.change(first, { target: { value: "654321" } });
    expect(values()).toBe("654321");
    await waitFor(() => expect(api.verifyEmailCode).toHaveBeenCalledWith("amina@example.test", "654321"));
  });

  it("Backspace on an empty box clears the one before and moves there; the arrows move between boxes", async () => {
    const user = userEvent.setup();
    mount(<Page />);
    await sendCode(user);
    await user.keyboard("123");
    expect(document.activeElement).toBe(boxes()[3]);
    await user.keyboard("{Backspace}");
    expect(values()).toBe("12");
    expect(document.activeElement).toBe(boxes()[2]);
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(document.activeElement).toBe(boxes()[0]);
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(boxes()[0]); // stays at the first
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(boxes()[1]);
    await user.keyboard("9"); // typing over a digit replaces it
    expect(boxes().map((b) => b.value)).toEqual(["1", "9", "", "", "", ""]);
    expect(api.verifyEmailCode).not.toHaveBeenCalled();
  });

  it("the app keeps the session token through platform.saveSession, never in the account", async () => {
    const save = vi.spyOn(platform, "saveSession").mockResolvedValue(undefined);
    vi.mocked(api.verifyEmailCode).mockResolvedValue({ ...ME, token: "t".repeat(43) });
    const user = userEvent.setup();
    mount(<Page />);
    await sendCode(user);
    await user.keyboard("654321");
    await waitFor(() => expect(store.getState().me?.id).toBe("u-email"));
    expect(save).toHaveBeenCalledWith("t".repeat(43));
    expect(store.getState().me).not.toHaveProperty("token");
  });

  it("an error shakes and clears the boxes and focuses the first; expired and too many tries say to send a new one", async () => {
    const user = userEvent.setup();
    mount(<Page />);
    await sendCode(user);
    vi.mocked(api.verifyEmailCode).mockRejectedValueOnce(refused(401, "wrong_code"));
    await user.keyboard("111111");
    expect((await screen.findByRole("alert")).textContent).toBe(t.emailWrong);
    expect(values()).toBe("");
    expect(group().classList.contains("shake")).toBe(true);
    expect(boxes()[0].getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(boxes()[0]);
    expect(store.getState().me).toBeNull();
    expect(getRoute().view).toBe("login");

    vi.mocked(api.verifyEmailCode).mockRejectedValueOnce(refused(410, "expired"));
    await user.keyboard("222222");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(t.emailExpired));
    expect(values()).toBe("");
    expect((screen.getByRole("button", { name: t.emailResend }) as HTMLButtonElement).disabled).toBe(false); // a new code is the way on

    vi.mocked(api.verifyEmailCode).mockRejectedValueOnce(refused(429, "too_many_attempts"));
    await user.keyboard("333333");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(t.emailTooMany));

    vi.mocked(api.verifyEmailCode).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await user.keyboard("444444");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(t.emailFailed));
    expect(document.activeElement).toBe(boxes()[0]);
  });

  it("sending: a bad address is caught before asking; refusals and failures are inline", async () => {
    const user = userEvent.setup();
    mount(<Page />);
    const field = screen.getByLabelText(t.emailLabel);
    expect(field.getAttribute("type")).toBe("email");
    expect(field.getAttribute("autocomplete")).toBe("email");
    expect(field.getAttribute("inputmode")).toBe("email");
    await user.type(field, "not-an-address");
    await user.click(screen.getByRole("button", { name: t.emailSend }));
    expect(screen.getByRole("alert").textContent).toBe(t.emailInvalid);
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(api.startEmailSignIn).not.toHaveBeenCalled();

    await user.clear(field);
    await user.type(field, "amina@example.test");
    vi.mocked(api.startEmailSignIn).mockRejectedValueOnce(refused(503, "unavailable"));
    await user.click(screen.getByRole("button", { name: t.emailSend }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(t.emailSendFailed));
    vi.mocked(api.startEmailSignIn).mockRejectedValueOnce(refused(429, "too many requests"));
    await user.click(screen.getByRole("button", { name: t.emailSend }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(t.emailWait));
    vi.mocked(api.startEmailSignIn).mockRejectedValueOnce(refused(400, "invalid email"));
    await user.click(screen.getByRole("button", { name: t.emailSend }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(t.emailInvalid));
    expect(screen.queryByRole("group", { name: t.emailCodeLabel })).toBeNull(); // still on the address

    await user.click(screen.getByRole("button", { name: t.emailSend })); // works this time
    expect(await screen.findByRole("group", { name: t.emailCodeLabel })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Resend code is enabled after 30 s and sends a new code; Use another email goes back to the address", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mount(<Page />);
    await sendCode(user);
    const resend = screen.getByRole("button", { name: t.emailResend }) as HTMLButtonElement;
    expect(resend.disabled).toBe(true);
    act(() => vi.advanceTimersByTime(29_000));
    expect(resend.disabled).toBe(true);
    act(() => vi.advanceTimersByTime(1_000));
    expect(resend.disabled).toBe(false);
    await user.click(resend);
    expect(api.startEmailSignIn).toHaveBeenCalledTimes(2);
    expect((await screen.findByRole("status")).textContent).toBe(t.emailResent("amina@example.test"));
    expect((screen.getByRole("button", { name: t.emailResend }) as HTMLButtonElement).disabled).toBe(true); // waits again
    expect(document.activeElement).toBe(boxes()[0]);

    await user.click(screen.getByRole("button", { name: t.emailOther }));
    const field = screen.getByLabelText(t.emailLabel) as HTMLInputElement;
    expect(field.value).toBe("amina@example.test"); // kept (an email field trims what it shows)
    expect(document.activeElement).toBe(field);
    expect(screen.queryByRole("group", { name: t.emailCodeLabel })).toBeNull();
  });

  it("returns to the screen ?next= names, in place of the login page", async () => {
    const user = userEvent.setup();
    mount(<Page />, {}, "/login?next=activity");
    await sendCode(user);
    await user.keyboard("123456");
    await waitFor(() => expect(getRoute().view).toBe("activity"));
    expect(location.pathname).toBe("/activity");
  });
});

describe("the name, for an account without one", () => {
  it("after sign-in: What should we call you?, then Continue saves it and returns", async () => {
    vi.mocked(api.verifyEmailCode).mockResolvedValue(NAMELESS);
    const user = userEvent.setup();
    mount(<Page />);
    await sendCode(user);
    await user.keyboard("123456");
    expect(await screen.findByRole("heading", { level: 1, name: t.nameAskTitle })).toBeTruthy();
    expect(getRoute().view).toBe("login"); // waits for the name
    const field = screen.getByLabelText(t.displayName) as HTMLInputElement;
    expect(field.getAttribute("autocomplete")).toBe("name");
    expect(field.maxLength).toBe(40);
    expect(document.activeElement).toBe(field);
    const go = screen.getByRole("button", { name: t.nameContinue }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    await user.type(field, "  Amina K ");
    await user.click(go);
    expect(api.patchMe).toHaveBeenCalledWith({ displayName: "Amina K" });
    await waitFor(() => expect(getRoute().view).toBe("find"));
    expect(store.getState().me?.displayName).toBe("Amina K");
  });

  it("Skip for now returns without a name; it is asked again (Profile) only a day later", async () => {
    vi.mocked(api.verifyEmailCode).mockResolvedValue(NAMELESS);
    const user = userEvent.setup();
    mount(<Page />);
    await sendCode(user);
    await user.keyboard("123456");
    await user.click(await screen.findByRole("button", { name: t.nameSkip }));
    await waitFor(() => expect(getRoute().view).toBe("find"));
    expect(api.patchMe).not.toHaveBeenCalled();
    expect(nameAskDue()).toBe(false);
    expect(nameAskDue(Date.now() + 24 * 3600 * 1000)).toBe(true);
  });

  it("an account with a Google name is not asked", async () => {
    vi.mocked(api.verifyEmailCode).mockResolvedValue({ ...NAMELESS, name: "Amina" });
    const user = userEvent.setup();
    mount(<Page />);
    await sendCode(user);
    await user.keyboard("123456");
    await waitFor(() => expect(getRoute().view).toBe("find"));
    expect(screen.queryByRole("heading", { name: t.nameAskTitle })).toBeNull();
  });
});

describe("every way in opens the login page", () => {
  it("the card: the mark, one line, Google in place and email on the login page (without Google: Log in or sign up)", async () => {
    const user = userEvent.setup();
    const { container, unmount } = mount(<JoinCard />, { googleClientId: "client-id" }, "/profile");
    expect(screen.getByRole("heading", { name: t.joinTitle })).toBeTruthy();
    expect(container.querySelector(".join-google")).toBeTruthy();
    expect(screen.queryByLabelText(t.emailLabel)).toBeNull();
    await user.click(screen.getByRole("button", { name: t.useEmailInstead }));
    expect(getRoute().view).toBe("login");
    expect(location.pathname).toBe("/login");
    unmount();

    mount(<JoinCard />, {}, "/profile");
    await user.click(screen.getByRole("button", { name: t.loginOpen }));
    expect(getRoute().view).toBe("login");
  });

  it("the invitation sheet: Google in place, Use email instead opens the login page (the sheet closes), Not now just closes", async () => {
    const user = userEvent.setup();
    mount(<><JoinSheet /><Page /></>, { googleClientId: "client-id" }, "/");
    act(() => askToJoin("like"));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByText(t.joinLikeSub)).toBeTruthy();
    expect(sheet.querySelector(".join-google")).toBeTruthy();
    await user.click(within(sheet).getByRole("button", { name: t.useEmailInstead }));
    expect(getJoin()).toBeNull();
    expect(getRoute().view).toBe("login");
    expect(screen.getByRole("heading", { level: 1, name: t.joinTitle })).toBeTruthy();

    act(() => navigate("find"));
    await waitFor(() => expect(getRoute().view).toBe("find"));
    resetJoin();
    act(() => askToJoin("create"));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: t.joinNotNow }));
    expect(getJoin()).toBeNull();
    expect(getRoute().view).toBe("find");
  });
});

describe("the bot check (Turnstile) before a code is sent", () => {
  type Options = Record<string, unknown> & { callback: (t: string) => void; "error-callback": () => void; "expired-callback": () => void };
  let widget: { render: ReturnType<typeof vi.fn>; reset: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  let options: Options;
  const SCRIPT = 'script[src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"]';
  const fake = (): TurnstileApi => {
    widget = { render: vi.fn((_el: HTMLElement, o: Options) => { options = o; return "w1"; }), reset: vi.fn(), remove: vi.fn() };
    return widget as unknown as TurnstileApi;
  };
  afterEach(() => {
    delete window.turnstile;
    document.querySelectorAll(SCRIPT).forEach((s) => s.remove());
  });

  it("loads the script only once the login page opens, renders the managed widget quietly, and sends its token", async () => {
    const user = userEvent.setup();
    mount(<Page />, { turnstileSiteKey: "0x4AAA-site" }, "/");
    expect(document.querySelector(SCRIPT)).toBeNull(); // nothing on page load
    act(() => navigate("login"));
    const script = document.querySelector<HTMLScriptElement>(SCRIPT)!;
    expect(script).not.toBeNull();
    window.turnstile = fake();
    act(() => void script.dispatchEvent(new Event("load")));
    await waitFor(() => expect(widget.render).toHaveBeenCalledTimes(1));
    expect(options).toMatchObject({ sitekey: "0x4AAA-site", action: "email-code", appearance: "interaction-only", size: "flexible", theme: "auto" });

    const field = screen.getByLabelText(t.emailLabel);
    await user.type(field, "amina@example.test");
    const sendButton = screen.getByRole("button", { name: t.emailSend }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true); // waits for the check
    act(() => options.callback("pass-1"));
    expect(sendButton.disabled).toBe(false);
    await user.click(sendButton);
    expect(api.startEmailSignIn).toHaveBeenCalledWith("amina@example.test", "pass-1");
    expect(widget.reset).toHaveBeenCalledWith("w1"); // single use: a new pass for the next send
    expect(await screen.findByRole("group", { name: t.emailCodeLabel })).toBeTruthy();
    expect(widget.render).toHaveBeenCalledTimes(1); // the same widget stays for Resend
  });

  it("a refused send resets the widget; errors say so and Try again resets it; a theme the person chose is used", async () => {
    document.documentElement.dataset.theme = "dark";
    window.turnstile = fake();
    const user = userEvent.setup();
    mount(<Page />, { turnstileSiteKey: "0x4AAA-site" });
    await waitFor(() => expect(widget.render).toHaveBeenCalled());
    expect(options.theme).toBe("dark");
    delete document.documentElement.dataset.theme;
    await user.type(screen.getByLabelText(t.emailLabel), "amina@example.test");

    act(() => options.callback("pass-1"));
    vi.mocked(api.startEmailSignIn).mockRejectedValueOnce(refused(403, "bot_check"));
    await user.click(screen.getByRole("button", { name: t.emailSend }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(t.emailBotFailed));
    expect(widget.reset).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: t.emailSend }) as HTMLButtonElement).disabled).toBe(true); // until a new pass

    act(() => options["error-callback"]());
    const alerts = screen.getAllByRole("alert").map((a) => a.textContent);
    expect(alerts.some((a) => a?.startsWith(t.emailBotFailed))).toBe(true);
    await user.click(screen.getByRole("button", { name: t.emailBotRetry }));
    expect(widget.reset).toHaveBeenCalledTimes(2);

    act(() => options.callback("pass-2"));
    act(() => options["expired-callback"]()); // Turnstile refreshes it; Send waits meanwhile
    expect((screen.getByRole("button", { name: t.emailSend }) as HTMLButtonElement).disabled).toBe(true);
    act(() => options.callback("pass-3"));
    await user.click(screen.getByRole("button", { name: t.emailSend }));
    expect(api.startEmailSignIn).toHaveBeenLastCalledWith("amina@example.test", "pass-3");
  });

  it("without a site key there is no script, no widget and no token", async () => {
    const user = userEvent.setup();
    mount(<Page />);
    await sendCode(user);
    expect(document.querySelector(SCRIPT)).toBeNull();
    expect(api.startEmailSignIn).toHaveBeenCalledWith("amina@example.test", undefined);
  });
});

describe("Sign in with Apple (the iOS app only)", () => {
  const apple = vi.fn<() => Promise<{ idToken: string; name?: string; authorizationCode?: string } | null>>();
  beforeEach(() => {
    apple.mockReset();
    vi.mocked(api.signInWithApple).mockReset().mockResolvedValue({ ...ME, id: "u-apple", token: "a".repeat(43) });
    vi.spyOn(platform, "saveSession").mockResolvedValue(undefined);
  });
  afterEach(() => { delete platform.appleSignIn; });
  const appleButton = () => screen.queryByRole("button", { name: t.signInWithApple });

  it("not on the web or Android (no appleSignIn): Google and email only", () => {
    mount(<Page />, { googleClientId: "client-id" });
    expect(appleButton()).toBeNull();
  });

  it("shows first, above Google and the email code, with the \"or\" before the email even without Google", () => {
    platform.appleSignIn = apple;
    const { container, unmount } = mount(<Page />, { googleClientId: "client-id" });
    const button = appleButton()!;
    expect(button.className).toBe("apple-signin");
    expect(button.querySelector("svg")).not.toBeNull(); // the Apple logo
    const google = container.querySelector(".join-google")!;
    const email = screen.getByLabelText(t.emailLabel);
    expect(button.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();

    mount(<Page />);
    expect(appleButton()).not.toBeNull();
    expect(screen.getByText(t.emailOr)).toBeTruthy();
  });

  it("signs in with the identity token, the first-time name and the authorization code; the app keeps its session token", async () => {
    platform.appleSignIn = apple.mockResolvedValue({ idToken: "apple-jwt", name: "Amina Khan", authorizationCode: "apple-code" });
    const user = userEvent.setup();
    mount(<Page />);
    await user.click(appleButton()!);
    await waitFor(() => expect(store.getState().me?.id).toBe("u-apple"));
    expect(api.signInWithApple).toHaveBeenCalledWith("apple-jwt", "Amina Khan", "apple-code");
    expect(platform.saveSession).toHaveBeenCalledWith("a".repeat(43));
    expect(store.getState().toast).toBeNull();
  });

  it("cancelling is quiet; a failure shows a toast", async () => {
    platform.appleSignIn = apple.mockResolvedValueOnce(null);
    const user = userEvent.setup();
    mount(<Page />);
    await user.click(appleButton()!);
    await waitFor(() => expect(apple).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(appleButton()!.hasAttribute("disabled")).toBe(false));
    expect(api.signInWithApple).not.toHaveBeenCalled();
    expect(store.getState().toast).toBeNull();
    expect(store.getState().me).toBeNull();

    vi.spyOn(console, "warn").mockImplementation(() => {});
    apple.mockRejectedValueOnce(new Error("AuthorizationError error 1000"));
    await user.click(appleButton()!);
    await waitFor(() => expect(store.getState().toast?.text).toBe(t.signInFailed));

    apple.mockResolvedValueOnce({ idToken: "apple-jwt" });
    vi.mocked(api.signInWithApple).mockRejectedValueOnce(new api.AuthError(401, "/api/auth/apple", "invalid credential"));
    store.dispatch({ type: "toast", text: "" });
    await user.click(appleButton()!);
    await waitFor(() => expect(store.getState().toast?.text).toBe(t.signInFailed));
    expect(store.getState().me).toBeNull();
  });
});
