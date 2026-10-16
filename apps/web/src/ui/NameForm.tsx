// The name (owner, 9 Oct 2026: make people add a name). An account without one (an email sign-up) is asked right after
// signing in, on the login page (screens/Login.tsx); put off, Profile asks again with a small card, at most once a day
// (join.ts). It is saved as the profile's display name and can be changed in Settings (Profile.tsx DetailsCard).
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { saveProfile } from "../actions";
import { nameAskDue, nameAsked, needsName } from "../join";
import { t } from "../strings";
import { useAppState, useStore } from "./hooks";
import "./screens/login.css";

export const NAME_MAX = 40;

/** One field, Continue (saves it) and a way to put it off. */
export function NameForm({ onSaved, onSkip, skip, focus = false }: { onSaved: () => void; onSkip: () => void; skip: string; focus?: boolean }) {
  const store = useStore();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => { if (focus) input.current?.focus(); }, [focus]);
  const value = name.trim();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!value || busy) return;
    setBusy(true);
    const ok = await saveProfile(store, { displayName: value });
    setBusy(false);
    if (ok) onSaved();
  };
  return (
    <form className="name-ask-form" onSubmit={(e) => void submit(e)} noValidate>
      <label htmlFor={id} className="label">{t.displayName}</label>
      <input ref={input} id={id} className="input" type="text" name="name" autoComplete="name" autoCapitalize="words" enterKeyHint="done"
        maxLength={NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} dir="auto" />
      <button type="submit" className="btn primary" disabled={!value || busy}>{t.nameContinue}</button>
      <button type="button" className="join-later" onClick={onSkip}>{skip}</button>
    </form>
  );
}

/** Profile, signed in without a name: the small prompt, at most once a day (shown counts as asked). */
export function NameCard({ active }: { active: boolean }) {
  const { me } = useAppState();
  const [asking, setAsking] = useState(false);
  const id = useId();
  const missing = needsName(me);
  useEffect(() => {
    if (!active || !missing || !nameAskDue()) return;
    nameAsked();
    setAsking(true);
  }, [active, missing]);
  if (!asking || !missing) return null;
  return (
    <section className="name-card" aria-labelledby={id}>
      <h2 id={id} className="name-card-title">{t.nameAskTitle}</h2>
      <NameForm onSaved={() => setAsking(false)} onSkip={() => setAsking(false)} skip={t.joinNotNow} />
    </section>
  );
}
