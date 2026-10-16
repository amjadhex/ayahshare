// Inviting people to sign up (owner, 8 Oct 2026; join.ts says when): the welcome after the first language choice, an
// ask after someone first makes or likes something, Log in on Home, and the card on Profile. Each opens the login page
// (screens/Login.tsx, owner 9 Oct 2026), where continuing with Google or with email (a code; EmailSignIn.tsx) signs up the
// first time and logs in after that. Nothing needs an account; every invitation can be put off.
import { useEffect, useId, useSyncExternalStore } from "react";
import { signedInOnDevice, signInOffered } from "../actions";
import { closeJoin, getJoin, subscribeJoin, type JoinReason } from "../join";
import { navigate } from "../router";
import { t } from "../strings";
import { platform } from "../platform";
import { AppleButton, Avatar, GoogleButton } from "./Account";
import { useAppState, useRoute } from "./hooks";
import { StreakPill } from "./Streak";
import { Sheet } from "./Sheet";
import { BrandMark } from "./screens/BrandLogo";
import "./join.css";

const COPY: Record<JoinReason, [title: string, sub: string]> = {
  login: [t.joinTitle, t.joinSub],
  welcome: [t.joinWelcomeTitle, t.joinWelcomeSub],
  create: [t.joinCreateTitle, t.joinCreateSub],
  like: [t.joinLikeTitle, t.joinLikeSub],
};

/** The way in: the login page. */
function LoginButton({ onClick }: { onClick?: () => void }) {
  return (
    <button type="button" className="btn primary join-open" onClick={() => { onClick?.(); navigate("login"); }}>{t.loginOpen}</button>
  );
}

/** The sign-in buttons themselves, not a button to a page with them (owner, 16 Oct 2026: fewer taps): Sign in with Apple
 *  (the iOS app), Sign in with Google, and a link to the login page for the email code. Without Apple or Google here, the
 *  login page's button. */
function SignInOptions({ onClick }: { onClick?: () => void }) {
  const { config } = useAppState();
  const google = !!config.googleClientId, apple = !!platform.appleSignIn;
  if (!google && !apple) return <LoginButton onClick={onClick} />;
  return (
    <>
      {apple && <AppleButton />}
      {google && <div className="join-google"><GoogleButton compact={false} /></div>}
      {config.emailSignIn && (
        <button type="button" className="join-email-link" onClick={() => { onClick?.(); navigate("login"); }}>{t.useEmailInstead}</button>
      )}
    </>
  );
}

/** Signed out, in place of what only an account shows (Profile, Activity, Settings): a compact card with the sign-in
 *  buttons. */
export function JoinCard({ sub = t.joinSub, className = "" }: { sub?: string; className?: string }) {
  const id = useId();
  return (
    <section className={`join join-card ${className}`.trim()} aria-labelledby={id}>
      <BrandMark size={40} />
      <h2 id={id} className="join-title">{t.joinTitle}</h2>
      <p className="join-sub">{sub}</p>
      <SignInOptions />
    </section>
  );
}

/** The invitation sheet. It waits while another sheet or the language question is open, and closes on sign-in. */
export function JoinSheet() {
  const reason = useSyncExternalStore(subscribeJoin, getJoin);
  const { me, langPicker } = useAppState();
  const route = useRoute();
  useEffect(() => { if (me) closeJoin(); }, [me, reason]);
  const open = !!reason && !me && !route.sheet && !langPicker && route.view !== "login";
  const shown = reason ?? "login";
  return (
    <Sheet open={open} title={COPY[shown][0]} onClose={closeJoin} className="join-sheet">
      {open && (
        <div className="join">
          <BrandMark size={52} />
          <p className="join-sub">{COPY[shown][1]}</p>
          <SignInOptions onClick={closeJoin} />
          <button type="button" className="join-later" onClick={closeJoin}>{t.joinNotNow}</button>
        </div>
      )}
    </Sheet>
  );
}

/** Whether the personal parts show (streak, numbers, creations, impact): signed in, or where sign-in is not offered
 *  (then the device's own data is all there is). Signed out they are still kept on the device and show on sign-in
 *  (owner, 8 Oct 2026: without an account, keep them but do not show them). */
export function usePersonal() {
  const { me, config } = useAppState();
  return !!me || !signInOffered(config);
}

/** Home's top bar when signed in (owner, 12 Oct 2026): the streak and the picture as one small pill, two buttons in it:
 *  the flame and the days open the streak's details (as the streak pill always did), the picture opens Profile. */
export function HomeMe({ active }: { active: boolean }) {
  return (
    <span className="home-me">
      <StreakPill active={active} className="home-me-streak" />
      <button type="button" className="home-me-pic" aria-label={t.navProfile} onClick={() => navigate("profile")}><Avatar /></button>
    </span>
  );
}

/** Home's top bar when signed out: Log in (the login page), where sign-in is offered. */
export function HomeAccount() {
  const { config } = useAppState();
  if (!signInOffered(config) || signedInOnDevice()) return null; // signed in before: the account is still loading
  // The Android app: straight to Google's account sheet (one tap); the login page stays a tap away on Profile. Elsewhere
  // (iOS offers Apple too, the web's Google button) the login page.
  const direct = platform.kind === "android" && !!config.googleClientId && platform.googleSignIn.supported;
  return <button type="button" className="home-login" onClick={() => (direct ? platform.googleSignIn.prompt() : navigate("login"))}>{t.logIn}</button>;
}
