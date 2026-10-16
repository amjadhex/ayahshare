// Email sign-in (owner, 8 Oct 2026), under Google on the login page (screens/Login.tsx): the address and Send code, then
// the 6-digit code in six boxes (owner, 9 Oct 2026; sent on its own once all six are in: typed, pasted anywhere, or filled
// by the phone's code suggestion, which fills the first box's one-time-code field), Resend code after 30 s and Use another
// email. Signing in puts the account in the store, as Google sign-in does; the login page then returns to where it was
// opened from. The app keeps its session token the same way (actions.ts signedIn).
// Where the server asks for it (/api/config turnstileSiteKey), a Turnstile bot check runs while this is open (seen only
// when it needs a tap) and each Send / Resend carries its single-use token.
import { useEffect, useId, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from "react";
import { sendEmailCode, signInWithEmail, type EmailProblem } from "../actions";
import { t } from "../strings";
import { loadTurnstile, TURNSTILE_ACTION, turnstileTheme, type TurnstileApi } from "../turnstile";
import { useAppState, useStore } from "./hooks";

/** The server sends at most one code per address every 30 s. */
export const RESEND_MS = 30_000;
const SAYS: Record<EmailProblem, string> = {
  invalid: t.emailInvalid, botCheck: t.emailBotFailed, wrong: t.emailWrong, expired: t.emailExpired, tooMany: t.emailTooMany,
  wait: t.emailWait, sendFailed: t.emailSendFailed, failed: t.emailFailed,
};
const digits = (s: string) => s.replace(/\D/g, "");
const EMPTY = ["", "", "", "", "", ""];
const looksLikeEmail = (s: string) => s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/** Turnstile while `on`, where the server gives a site key: the widget goes in `box` (managed, shown only when it needs a
 *  tap), `token` is the current pass (single use: `reset` after each send gets a new one), `failed` when it could not
 *  run (Try again resets it, or loads the script again). The script loads the first time this is on. */
function useBotCheck(siteKey: string | undefined, on: boolean) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<{ api: TurnstileApi; id: string } | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!siteKey || !on) return;
    let alive = true;
    loadTurnstile().then((api) => {
      if (!alive || !box.current) return;
      const id = api.render(box.current, {
        sitekey: siteKey, action: TURNSTILE_ACTION, appearance: "interaction-only", size: "flexible", theme: turnstileTheme(),
        callback: (pass: string) => { if (alive) { setToken(pass); setFailed(false); } },
        "expired-callback": () => { if (alive) setToken(null); }, // Turnstile gets a fresh one by itself
        "error-callback": () => { if (alive) { setToken(null); setFailed(true); } return true; },
        "timeout-callback": () => { if (alive) { setToken(null); setFailed(true); } },
      });
      if (id) widget.current = { api, id };
    }, () => { if (alive) setFailed(true); });
    return () => {
      alive = false;
      if (widget.current) widget.current.api.remove(widget.current.id);
      widget.current = null;
      setToken(null);
    };
  }, [siteKey, on, round]);
  const reset = () => {
    if (!siteKey) return;
    setToken(null);
    setFailed(false);
    if (widget.current) widget.current.api.reset(widget.current.id);
    else setRound((n) => n + 1);
  };
  return { box, needed: !!siteKey, waiting: !!siteKey && !token, token, failed, reset };
}

export function EmailSignIn({ divider }: { divider: boolean }) {
  const store = useStore();
  const { config } = useAppState();
  const [step, setStep] = useState<"email" | "code">("email");
  const bot = useBotCheck(config.turnstileSiteKey, true);
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [resent, setResent] = useState(false);
  const [cells, setCells] = useState(EMPTY);
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<EmailProblem | null>(null);
  const [sentAt, setSentAt] = useState(0);
  const [canResend, setCanResend] = useState(false);
  const emailInput = useRef<HTMLInputElement>(null);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const moved = useRef(false); // focus follows a step the person took (not the page opening: no keyboard over Google)
  const id = useId();
  const ids = { email: `${id}-email`, code: `${id}-code`, sent: `${id}-sent`, problem: `${id}-problem` };
  const box = (i: number) => boxes.current[Math.max(0, Math.min(5, i))];

  useEffect(() => {
    if (!moved.current) return;
    if (step === "email") emailInput.current?.focus();
    if (step === "code") box(0)?.focus();
  }, [step, sentAt]);
  useEffect(() => {
    if (!sentAt) return;
    const timer = setTimeout(() => setCanResend(true), RESEND_MS);
    return () => clearTimeout(timer);
  }, [sentAt]);

  const send = async (to: string, again: boolean) => {
    setBusy(true);
    setProblem(null);
    const p = await sendEmailCode(to, bot.token ?? undefined);
    bot.reset(); // used (or refused): the next send needs a new pass
    setBusy(false);
    if (p) return setProblem(p);
    setSentTo(to);
    setResent(again);
    setCells(EMPTY);
    moved.current = true;
    setCanResend(false);
    setSentAt(Date.now());
    setStep("code");
  };
  const submitEmail = (e: FormEvent) => {
    e.preventDefault();
    const to = email.trim();
    if (!looksLikeEmail(to)) return setProblem("invalid");
    void send(to, false);
  };
  const verify = async (value: string) => {
    if (busy || value.length !== 6) return;
    setBusy(true);
    setProblem(null);
    const p = await signInWithEmail(store, sentTo, value);
    setBusy(false);
    if (!p) return; // signed in: the sheet closes / the card goes
    setProblem(p);
    if (p === "expired" || p === "tooMany") setCanResend(true); // a new code is the way on
    setCells(EMPTY); // the boxes shake and clear; the first is ready for the next try
    setShake(true);
    box(0)?.focus();
  };

  // ---------- the six boxes ----------
  /** Puts `next` in the boxes and sends the code once all six are in. */
  const put = (next: string[]) => {
    setCells(next);
    if (next.every(Boolean)) void verify(next.join(""));
  };
  /** Digits from `from` on (a whole code from the first box): pasted, or the phone's code suggestion. */
  const fill = (from: number, text: string) => {
    const d = digits(text);
    if (!d) return;
    const start = d.length >= 6 ? 0 : from;
    const next = [...cells];
    for (let k = 0; k < d.length && start + k < 6; k++) next[start + k] = d[k];
    box(start + d.length)?.focus();
    put(next);
  };
  const typed = (i: number, value: string) => {
    const d = digits(value);
    if (d.length > 1 && !(d.length === 2 && cells[i] && d.includes(cells[i]))) return fill(i, d);
    const next = [...cells];
    next[i] = d.length === 2 ? (d[0] === cells[i] ? d[1] : d[0]) : d; // typed into a full box: the new digit
    if (next[i]) box(i + 1)?.focus();
    put(next);
  };
  const keyed = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !cells[i] && i > 0) {
      e.preventDefault();
      setCells(cells.map((c, k) => (k === i - 1 ? "" : c)));
      box(i - 1)?.focus();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      box(i + (e.key === "ArrowLeft" ? -1 : 1))?.focus();
    }
  };
  const pasted = (i: number, e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault(); // "123 456" from the email: all six boxes
    fill(i, e.clipboardData.getData("text"));
  };
  const anotherEmail = () => {
    setStep("email");
    setProblem(null);
    setCells(EMPTY);
    setSentAt(0);
    moved.current = true;
  };
  const code = cells.join("");

  const said = problem && <p id={ids.problem} className="join-email-problem" role="alert">{SAYS[problem]}</p>;
  return (
    <div className="join-email">
      {divider && <p className="join-or"><span>{t.emailOr}</span></p>}
      {step === "email" && (
        <form className="join-email-form" onSubmit={submitEmail} noValidate>
          <label htmlFor={ids.email} className="label">{t.emailLabel}</label>
          <input
            ref={emailInput} id={ids.email} className="input" type="email" name="email" autoComplete="email" inputMode="email"
            autoCapitalize="none" spellCheck={false} maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)}
            aria-invalid={problem === "invalid" || undefined} aria-describedby={problem ? ids.problem : undefined}
          />
          <button type="submit" className="btn primary" disabled={busy || bot.waiting}>{busy ? t.emailSending : t.emailSend}</button>
          {said}
        </form>
      )}
      {step === "code" && (
        <form className="join-email-form" onSubmit={(e) => { e.preventDefault(); void verify(code); }} noValidate>
          <p id={ids.sent} className="join-email-sent" role="status">{resent ? t.emailResent(sentTo) : t.emailSent(sentTo)}</p>
          <p id={ids.code} className="label">{t.emailCodeLabel}</p>
          <div className={`join-code-boxes${shake ? " shake" : ""}`} role="group" aria-labelledby={ids.code}
            aria-describedby={problem ? `${ids.sent} ${ids.problem}` : ids.sent} onAnimationEnd={() => setShake(false)}>
            {cells.map((c, i) => (
              <input
                key={i} ref={(el) => { boxes.current[i] = el; }} className="join-code-box" type="text" name={i ? undefined : "code"}
                inputMode="numeric" pattern="[0-9]*" autoComplete={i ? "off" : "one-time-code"} aria-label={t.emailDigit(i + 1)}
                value={c} readOnly={busy} aria-invalid={problem === "wrong" || undefined}
                onChange={(e) => typed(i, e.target.value)} onKeyDown={(e) => keyed(i, e)} onPaste={(e) => pasted(i, e)}
                onFocus={(e) => e.target.select()}
              />
            ))}
          </div>
          <button type="submit" className="btn primary" disabled={busy || code.length !== 6}>{busy ? t.emailVerifying : t.emailVerify}</button>
          {said}
          <div className="join-email-more">
            <button type="button" className="btn ghost" disabled={!canResend || busy || bot.waiting} onClick={() => void send(sentTo, true)}>{t.emailResend}</button>
            <button type="button" className="btn ghost" onClick={anotherEmail}>{t.emailOther}</button>
          </div>
        </form>
      )}
      {bot.needed && <div ref={bot.box} className="join-bot" />}
      {bot.failed && (
        <p className="join-email-problem" role="alert">
          {t.emailBotFailed} <button type="button" className="join-email-retry" onClick={bot.reset}>{t.emailBotRetry}</button>
        </p>
      )}
    </div>
  );
}
