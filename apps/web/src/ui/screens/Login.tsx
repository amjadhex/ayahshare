// The login page (owner, 9 Oct 2026), /login, full screen: everywhere sign-in starts opens it (Log in on Home, the cards
// on Profile, Activity and Settings, the invitation sheet). Close, the mark, "Sign up or log in", one line, Sign in with
// Apple (the iOS app only, first), Sign in with Google (where offered), "or", then the email code at once
// (EmailSignIn.tsx); the privacy policy and terms at the foot.
// After signing in it returns to where it was opened from (Back, or the screen named by ?next=), first asking an account
// without a name what to call it (NameForm.tsx). Opened while signed in, it returns at once.
import { useEffect, useRef, useState } from "react";
import { signedInOnDevice, signInOffered } from "../../actions";
import { apiBase } from "../../endpoint";
import { platform } from "../../platform";
import { nameAsked, needsName } from "../../join";
import { back, replaceView, type View } from "../../router";
import { t } from "../../strings";
import { AppleButton, GoogleButton } from "../Account";
import { EmailSignIn } from "../EmailSignIn";
import { useAppState } from "../hooks";
import { CloseIcon } from "../icons";
import { NameForm } from "../NameForm";
import { BrandMark } from "./BrandLogo";
import "../join.css";
import "./login.css";

const VIEWS: View[] = ["find", "results", "pick", "create", "share", "discover", "feed", "profile", "activity", "settings"];

/** The screen ?next= names, if any. */
function nextView(): View | null {
  const v = new URLSearchParams(location.search).get("next") as View | null;
  return v && VIEWS.includes(v) ? v : null;
}

export function Login({ active }: { active: boolean }) {
  const { me, config } = useAppState();
  const [asking, setAsking] = useState(false);
  const next = useRef<View | null>(null);
  const signingIn = useRef(false); // signed out when the page opened (not an account still loading)
  const left = useRef(false); // once: the account may change again before Back lands
  const leave = () => {
    if (left.current) return;
    left.current = true;
    const to = next.current;
    next.current = null;
    if (to) replaceView(to);
    else back();
  };
  useEffect(() => {
    if (!active) {
      signingIn.current = false;
      left.current = false;
      setAsking(false);
      return;
    }
    if (!me) {
      if (!signingIn.current) next.current = nextView();
      signingIn.current ||= !signedInOnDevice();
      return;
    }
    if (asking) return;
    if (signingIn.current && needsName(me)) {
      setAsking(true);
      return;
    }
    if (!signingIn.current) next.current ??= nextView();
    leave();
  }, [active, me]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!active) return null;
  return (
    <div className="login">
      <header className="login-bar">
        <button type="button" className="login-close" aria-label={t.close} title={t.close} onClick={leave}><CloseIcon /></button>
      </header>
      <div className="login-body join">
        <BrandMark size={56} />
        {asking ? (
          <>
            <h1 className="login-title">{t.nameAskTitle}</h1>
            <p className="join-sub">{t.nameAskSub}</p>
            <NameForm focus onSaved={leave} onSkip={() => { nameAsked(); leave(); }} skip={t.nameSkip} />
          </>
        ) : (
          <>
            <h1 className="login-title">{t.joinTitle}</h1>
            <p className="join-sub">{t.loginSub}</p>
            {!signInOffered(config) && <p className="join-sub">{t.signInUnavailable}</p>}
            {platform.appleSignIn && <AppleButton />}
            {config.googleClientId && <div className="join-google"><GoogleButton compact={false} /></div>}
            {config.emailSignIn && <EmailSignIn divider={!!config.googleClientId || !!platform.appleSignIn} />}
          </>
        )}
      </div>
      <footer className="login-foot">
        <a href={`${apiBase()}/privacy`} target="_blank" rel="noopener">{t.privacyPolicy}</a>
        <span aria-hidden="true">·</span>
        <a href={`${apiBase()}/terms`} target="_blank" rel="noopener">{t.termsOfService}</a>
      </footer>
    </div>
  );
}
