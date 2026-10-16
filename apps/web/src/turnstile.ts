// Cloudflare Turnstile, the bot check before an email sign-in code is sent (ui/EmailSignIn.tsx). Its script loads only
// when the email step is open on a server that asks for the check (/api/config turnstileSiteKey), and once per page.
// Framework-free.

const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
/** The same action the server checks (apps/api src/lib/turnstile.ts TURNSTILE_ACTION). */
export const TURNSTILE_ACTION = "email-code";

export interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string | undefined;
  reset(id: string): void;
  remove(id: string): void;
}
declare global { interface Window { turnstile?: TurnstileApi } }

let loading: Promise<TurnstileApi> | null = null;

export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return (loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const s = Object.assign(document.createElement("script"), { src: SRC, async: true });
    const fail = () => {
      loading = null; // blocked or offline: the next try loads it again
      s.remove();
      reject(new Error("turnstile"));
    };
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : fail());
    s.onerror = fail;
    document.head.append(s);
  }));
}

/** The app's colours: a theme the person chose (html data-theme), else the system's, as Turnstile's "auto" does. */
export const turnstileTheme = () => {
  const chosen = document.documentElement.dataset.theme;
  return chosen === "light" || chosen === "dark" ? chosen : "auto";
};
