// Optional Google sign-in (and Sign in with Apple in the iOS app): the sign-in controls and the account picture.
// Everything else works signed out (favourites, preferences and saved designs are kept on the device); the sign-in
// parts do not show without a client id. Saved designs are in Saved.tsx, the settings in Profile.tsx; the privacy and
// terms links in screens/Settings.tsx.
import { useEffect, useRef, useState } from "react";
import { signInWithApple } from "../actions";
import { platform } from "../platform";
import { t } from "../strings";
import { useAppState, useStore } from "./hooks";

const whenIdle = (fn: () => void) => ("requestIdleCallback" in window ? requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 1500));

/** Google's button (web) or the app's sign-in button, loaded when the page is idle. */
export function GoogleButton({ compact }: { compact: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    whenIdle(() => { if (alive && ref.current) platform.googleSignIn.mount(ref.current, compact).catch(() => alive && setFailed(true)); });
    return () => { alive = false; };
  }, [compact]);
  return failed ? null : <div ref={ref} className="gsi" />;
}

/** Sign in with Apple, where the platform offers it (the iOS app). Apple's button guidelines: black (white in dark mode),
 *  the Apple logo and "Sign in with Apple", as tall as the other sign-in buttons. */
export function AppleButton() {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const signIn = async () => {
    setBusy(true);
    try { await signInWithApple(store); } finally { setBusy(false); }
  };
  return (
    <button type="button" className="apple-signin" disabled={busy} onClick={() => void signIn()}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
      </svg>
      <span>{t.signInWithApple}</span>
    </button>
  );
}

export function Avatar() {
  const { me } = useAppState();
  if (!me) return null;
  return me.avatar
    ? <img src={me.avatar} alt="" referrerPolicy="no-referrer" />
    : <span>{(me.name || me.email || "?").trim()[0].toUpperCase()}</span>;
}

// ---------- phones ----------

/** Phones: the app bar button that opens the Profile screen (signed in: the picture; signed out: a person icon, where
 *  sign-in and this device's preferences are). */
