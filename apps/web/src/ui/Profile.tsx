// The forms of the person, in two places. Settings (screens/Settings.tsx, styled by screens/settings.css) shows the account:
// the header (Google picture, name, email, member since) or the sign-in card, the details (the name, location, and the
// WhatsApp number as a country code and the number), sign out and delete account. Preferences (a sheet on Profile, screens/ProfileScreen.tsx) holds what new designs start with and
// what the feed leans towards: My language and the default translation, the translation voice, the default reciter, the
// design defaults and the interests (a few chosen ones and suggestions; the full list opens in a sheet). Signed out, the
// device keeps them (`qd.prefs`, `qd.interests`).
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Prefs, ProfilePatch, Recipe, Topic } from "../../../../contracts/types";
import { deleteAccount, refreshProfile, saveProfile, setInterests, setPrefs, signInOffered, signOut } from "../actions";
import * as api from "../api";
import { RECITERS } from "../config";
import { MOODS } from "../feed";
import { languageOf } from "../lang";
import { callingCode, flagOf, joinPhone, splitPhone } from "../phone";
import { COUNTRY_CODES, MAX_INTERESTS } from "../prefs";
import { closeSheet, openSheet } from "../router";
import { t } from "../strings";
import { editionOf, matches, queryWords, shortTranslationName } from "../translations";
import { Avatar } from "./Account";
import { quietFocus } from "./focus";
import { JoinCard } from "./Join";
import { NAME_MAX } from "./NameForm";
import { Field, Segmented, Toggle } from "./controls";
import { useAppState, useRoute, useStore } from "./hooks";
import { CloseIcon, EditIcon, PhoneIcon, PinIcon, SearchIcon, SignOutIcon, TrashIcon } from "./icons";
import { PickerRow, PickRowButton } from "./PickerRow";
import { Sheet } from "./Sheet";
import { editionLabel, TranslationPicker } from "./TranslationPicker";
import "./prefs.css";

const regions = (() => {
  try { return new Intl.DisplayNames(["en"], { type: "region" }); } catch { return null; }
})();
export const countryName = (cc: string) => { try { return regions?.of(cc) ?? cc; } catch { return cc; } };
const COUNTRIES = COUNTRY_CODES.map((cc) => [cc, countryName(cc)] as const).sort((a, b) => a[1].localeCompare(b[1]));
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The account sections of Settings. `active`: on screen (the profile is read again each time it is shown). */
export function AccountSections({ active = true }: { active?: boolean }) {
  const store = useStore();
  const { me } = useAppState();
  // The numbers (designs, share links) change with every export: read the profile again when it is shown.
  const id = me?.id;
  useEffect(() => { if (active && id) void refreshProfile(store); }, [active, id, store]);
  // Signed out or deleted: back to the top, where the sign-in card is.
  const page = useRef<HTMLDivElement>(null);
  const had = useRef(!!id);
  useEffect(() => {
    if (had.current && !id) page.current?.parentElement?.scrollTo?.({ top: 0 });
    had.current = !!id;
  }, [id]);
  return (
    <div className="profile-page" ref={page}>
      {/* Keys differ per card (two siblings with one key left the old header on screen after sign-out); they change with the account so no form state carries over. */}
      {me ? <ProfileHead key={`head-${me.id}`} /> : <SignInCard />}
      {me && <DetailsCard key={`details-${me.id}`} />}
      {me && <AccountCard />}
    </div>
  );
}

/** Signed out: the same sign-up card as Profile (Join.tsx); without Google or email sign-in, it is not offered yet. */
function SignInCard() {
  const { config } = useAppState();
  return signInOffered(config) ? <JoinCard /> : <section className="profile-card"><p className="muted small">{t.signInUnavailable}</p></section>;
}

/** The name field of the details (the header's Edit name goes there). */
const NAME_FIELD = "profile-name-field";

function ProfileHead() {
  const { me } = useAppState();
  if (!me) return null;
  const shown = me.displayName || me.name || me.email;
  const editName = () => {
    const field = document.getElementById(NAME_FIELD) as HTMLInputElement | null;
    field?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    field?.focus({ preventScroll: true });
    field?.select();
  };
  const since = me.memberSince ? new Date(me.memberSince).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : null;
  return (
    <section className="profile-card profile-head">
      <span className="avatar big"><Avatar /></span>
      <div className="profile-who">
        <div className="name-row">
          <strong className="profile-name" dir="auto">{shown}</strong>
          <button type="button" className="icon-btn ghost" aria-label={t.editName} title={t.editName} onClick={editName}><EditIcon /></button>
        </div>
        <p className="muted profile-email">{me.email}</p>
        {since && <p className="muted small">{t.memberSince(since)}</p>}
      </div>
    </section>
  );
}

/** The preferences for new designs and the feed, in the Preferences sheet of Profile: groups of rows, each a label with its
 *  value that opens its own picker. `active`: the screen is shown (the topic list loads only then). */
export function PreferencesPanel({ active = true }: { active?: boolean }) {
  const { me } = useAppState();
  return (
    <div className="prefs">
      <p className="muted small prefs-hint">{me ? t.prefsHint : t.prefsDevice}</p>
      <LanguageGroup />
      <RecitationGroup />
      <DesignGroup />
      <InterestsGroup active={active} />
    </div>
  );
}

function PrefGroup({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="pref-group" aria-labelledby={id}>
      <h3 id={id} className="pref-heading">{title}</h3>
      <div className="pref-card">{children}</div>
    </section>
  );
}

/** My language, the default translation (two-step picker in a sheet) and the translation voice. */
function LanguageGroup() {
  const store = useStore();
  const { prefs, lang, editions } = useAppState();
  const route = useRoute();
  const language = languageOf(lang);
  const defaultEdition = editionOf(editions, language.translation);
  const langTranslation = language.translation === "none" ? t.noTranslation : defaultEdition ? shortTranslationName(defaultEdition) : language.native;
  const set = (patch: Partial<Prefs>) => setPrefs(store, { ...prefs, ...patch });
  // The default translation: a row showing it, opening the translation picker over this sheet (Back closes only it).
  const picking = route.sheet === "translation";
  const trigger = useRef<HTMLButtonElement>(null);
  const translation = prefs.translation ? editionLabel(prefs.translation, editions, lang) : t.sameAsLanguage(langTranslation);
  return (
    <PrefGroup title={t.prefLanguageGroup}>
      <PickRowButton label={t.myLanguage} value={language.native !== language.english ? `${language.native} · ${language.english}` : language.native}
        onClick={() => store.dispatch({ type: "langPicker", open: "change" })} />
      <PickRowButton ref={trigger} label={t.defaultTranslation} value={translation} expanded={picking} onClick={() => openSheet("translation", true)} />
      <Sheet open={picking} title={t.defaultTranslation} onClose={closeSheet} className="trp-sheet" done={t.done}>
        {picking && (
          <TranslationPicker label={t.defaultTranslation} value={prefs.translation ?? ""} onPicked={closeSheet}
            extra={[{ value: "", label: t.sameAsLanguage(langTranslation) }]} onChange={(v) => set({ translation: v || undefined })} />
        )}
      </Sheet>
      {/* One switch (owner): the translation voice for new designs and for the Feed alike. */}
      <div className="pref-toggle">
        <Toggle label={t.hearMeaning(lang)} on={!!prefs.voice} onChange={(v) => set({ voice: v, feedVoice: v })} />
        <p className="hint">{t.prefVoiceHint}</p>
      </div>
    </PrefGroup>
  );
}

function RecitationGroup() {
  const store = useStore();
  const { prefs } = useAppState();
  return (
    <PrefGroup title={t.prefRecitationGroup}>
      <PickerRow label={t.defaultReciter} value={prefs.reciter ?? RECITERS[0][0]} options={RECITERS.map(([value, label]) => ({ value, label }))}
        onChange={(v) => setPrefs(store, { ...prefs, reciter: v })} />
    </PrefGroup>
  );
}

function DesignGroup() {
  const store = useStore();
  const { prefs } = useAppState();
  const set = (patch: Partial<Prefs>) => setPrefs(store, { ...prefs, ...patch });
  return (
    <PrefGroup title={t.prefDesignGroup}>
      <Field label={t.defaultOrientation}>{(id) => (
        <Segmented<Recipe["orientation"]> labelledBy={id} value={prefs.orientation ?? "portrait"}
          options={[["portrait", t.portrait], ["square", t.square], ["landscape", t.landscape]]} onChange={(v) => set({ orientation: v })} />
      )}</Field>
      <Field label={<>{t.defaultStyle} <small>{t.effect}</small></>}>{(id) => (
        <Segmented<NonNullable<Prefs["effect"]>> labelledBy={id} value={prefs.effect ?? "solid"}
          options={[["shade", t.effectShade], ["glass", t.effectGlass], ["solid", t.effectSolid], ["shadow", t.effectShadow], ["outline", t.effectOutline], ["none", t.effectNone]]}
          onChange={(v) => set({ effect: v })} />
      )}</Field>
      <Field label={t.animation}>{(id) => (
        <Segmented<NonNullable<Prefs["animation"]>> labelledBy={id} value={prefs.animation ?? "none"}
          options={[["none", t.animNone], ["fade", t.animFade], ["rise", t.animRise], ["zoom", t.animZoom]]} onChange={(v) => set({ animation: v })} />
      )}</Field>
    </PrefGroup>
  );
}

/** How many suggestions sit beside the chosen interests before "Show all". */
const SUGGESTED = 6;

/** Interests, compact: the chosen ones and a few suggestions; "Show all" opens every topic, searchable, in a sheet. */
function InterestsGroup({ active }: { active: boolean }) {
  const store = useStore();
  const { interests } = useAppState();
  const route = useRoute();
  const [topics, setTopics] = useState<Topic[] | null | "failed">(null);
  const [q, setQ] = useState("");
  const head = useId(), search = useId();
  useEffect(() => {
    if (!active || Array.isArray(topics)) return;
    let alive = true;
    api.getTopics().then((f) => alive && setTopics(f.topics), () => alive && setTopics("failed"));
    return () => { alive = false; };
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  const popular = useMemo(() => new Set(MOODS.flatMap((m) => m.topics)), []);
  const full = interests.length >= MAX_INTERESTS;
  const toggle = (id: string) => setInterests(store, interests.includes(id) ? interests.filter((x) => x !== id) : [...interests, id]);
  const showing = active && route.sheet === "interests";

  const chip = (tp: Topic) => {
    const on = interests.includes(tp.id);
    return (
      <button key={tp.id} type="button" aria-pressed={on} disabled={!on && full} onClick={() => toggle(tp.id)}>
        {capital(tp.label)}{on && <CloseIcon />}
      </button>
    );
  };
  let compact: Topic[] = [], everything: Topic[] = [];
  if (Array.isArray(topics)) {
    const picked = topics.filter((tp) => interests.includes(tp.id));
    const rest = topics.filter((tp) => !interests.includes(tp.id));
    compact = [...picked, ...rest.filter((tp) => popular.has(tp.id)).slice(0, SUGGESTED)];
    const words = queryWords(q);
    everything = [...picked, ...rest].filter((tp) => !words.length || matches(words, [tp.label, tp.id]));
  }
  return (
    <section className="pref-group" aria-labelledby={head}>
      <h3 id={head} className="pref-heading">{t.interests}<span className="count">{t.interestsCount(interests.length)}</span></h3>
      <div className="pref-card">
        <p className="hint pref-note">{full ? t.interestsMax : t.interestsHint}</p>
        {topics === null ? <p className="hint">{t.loadingAyahs}</p> : topics === "failed" ? <p className="hint">{t.topicsFailed}</p> : (
          <>
            <div className="interest-chips" role="group" aria-labelledby={head}>{compact.map(chip)}</div>
            <button type="button" className="link-btn" aria-haspopup="dialog" onClick={() => { setQ(""); openSheet("interests", true); }}>{t.showAllTopics(topics.length)}</button>
          </>
        )}
      </div>
      <Sheet open={showing} title={t.interests} onClose={closeSheet} className="trp-sheet interests-sheet" done={t.done}>
        {showing && (
          <div className="trp">
            <div className="search small trp-search">
              <SearchIcon />
              <input id={search} type="search" aria-label={t.interestsFilter} placeholder={t.interestsFilter} autoComplete="off" spellCheck={false} value={q}
                onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape" && q) { e.preventDefault(); e.stopPropagation(); setQ(""); } }} />
            </div>
            <p className="hint pref-note">{t.interestsCount(interests.length)} · {full ? t.interestsMax : t.interestsHint}</p>
            <div className="interest-chips all" role="group" aria-label={t.interests}>
              {everything.length === 0 ? <p className="hint">{t.interestsNone}</p> : everything.map(chip)}
            </div>
          </div>
        )}
      </Sheet>
    </section>
  );
}

/** The phone's country code: the flag (or the ISO code where there are none), the name and +code. */
const PHONE_CODES = COUNTRIES.filter(([cc]) => callingCode(cc)).map(([cc, name]) => ({ value: cc, label: `${flagOf(cc)} ${name}`, detail: `+${callingCode(cc)}` }));

function DetailsCard() {
  const store = useStore();
  const { me } = useAppState();
  const [name, setName] = useState<string | null>(null); // null: not changed here (shows the account's)
  const [country, setCountry] = useState(me?.country ?? me?.requestCountry ?? "");
  const [city, setCity] = useState(me?.city ?? "");
  // The number in two parts: the code follows the country until one is picked by hand (a stored number keeps its own).
  const stored = splitPhone(me?.phone, me?.country ?? me?.requestCountry);
  const [code, setCode] = useState(stored?.cc ?? country);
  const [codePicked, setCodePicked] = useState(!!stored);
  const [national, setNational] = useState(stored?.national ?? me?.phone ?? "");
  const [optIn, setOptIn] = useState(!!me?.phoneOptIn);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const ids = { head: useId(), city: useId(), phone: useId(), hint: useId(), error: useId(), nameError: useId(), nameHint: useId() };
  if (!me) return null;
  const savedName = me.displayName || me.name || "";
  const typedName = (name ?? savedName).trim();
  const nameBad = touched && !typedName;
  const number = joinPhone(code, national);
  const phoneBad = number === undefined;
  const suggested = !me.country && me.requestCountry && country === me.requestCountry;
  const pickCountry = (v: string) => {
    setCountry(v);
    if (!codePicked && v) setCode(v);
    setStatus("");
  };
  const pickCode = (v: string) => {
    setCode(v);
    setCodePicked(true);
    setStatus("");
  };
  /** A number typed with its own +code: split into the two parts. */
  const tidyNumber = () => {
    setTouched(true);
    const full = /^(\+|00)/.test(national.trim()) ? joinPhone(code, national) : null;
    const parts = full ? splitPhone(full, country) : null;
    if (parts) { pickCode(parts.cc); setNational(parts.national); }
  };

  const save = async (patch: ProfilePatch) => {
    setBusy(true);
    setStatus("");
    const ok = await saveProfile(store, patch);
    setBusy(false);
    if (ok) setStatus(t.detailsSaved);
    return ok;
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (phoneBad || !typedName) return;
    const patch: ProfilePatch = { country: country || null, city: city.trim() || null, phone: number ?? null, phoneOptIn: !!number && optIn };
    if (typedName !== savedName) patch.displayName = typedName;
    if (await save(patch)) setName(null);
  };
  const removeNumber = async () => {
    if (await save({ phone: null, phoneOptIn: false })) {
      setNational("");
      setOptIn(false);
    }
  };

  return (
    <section className="profile-card" aria-labelledby={ids.head}>
      <div className="profile-card-head">
        <h2 id={ids.head} className="profile-title"><PinIcon />{t.detailsTitle}</h2>
        <p className="muted small">{t.detailsOptional}</p>
      </div>
      <form className="panel details-form" onSubmit={(e) => void submit(e)} noValidate>
        <Field label={t.displayName} htmlFor={NAME_FIELD}>{() => (
          <>
            <input id={NAME_FIELD} type="text" className="input" maxLength={Math.max(NAME_MAX, savedName.length)} autoComplete="name" dir="auto"
              value={name ?? savedName} aria-invalid={nameBad} aria-describedby={nameBad ? `${ids.nameHint} ${ids.nameError}` : ids.nameHint}
              onChange={(e) => { setName(e.target.value); setStatus(""); }} />
            {nameBad && <p id={ids.nameError} className="field-error" role="alert">{t.nameNeeded}</p>}
            <p id={ids.nameHint} className="hint">{t.nameHint}</p>
          </>
        )}</Field>
        <div className="row">
          <div className="field">
            <PickerRow label={t.country} value={country} options={[{ value: "", label: t.noCountry }, ...COUNTRIES.map(([cc, name]) => ({ value: cc, label: name }))]}
              onChange={pickCountry} hint={suggested ? t.suggestedCountry(countryName(country)) : undefined} />
          </div>
          <Field label={t.city} htmlFor={ids.city}>{() => (
            <input id={ids.city} type="text" className="input" maxLength={80} autoComplete="address-level2" placeholder={t.cityPlaceholder}
              value={city} onChange={(e) => { setCity(e.target.value); setStatus(""); }} />
          )}</Field>
        </div>
        <Field label={<><PhoneIcon />{t.phone}</>} htmlFor={ids.phone}>{() => (
          <>
            <div className="phone-row">
              <PickerRow className="phone-code" label={t.phoneCode} title={t.phoneCodeTitle} value={code} options={PHONE_CODES} onChange={pickCode}
                display={code ? `${flagOf(code)} +${callingCode(code)}` : t.phoneCodeNone} />
              <input id={ids.phone} type="tel" className="input" inputMode="tel" autoComplete="tel-national" maxLength={24}
                value={national} aria-invalid={touched && phoneBad} aria-describedby={`${ids.hint}${touched && phoneBad ? ` ${ids.error}` : ""}`}
                onChange={(e) => { setNational(e.target.value); setStatus(""); }} onBlur={tidyNumber} />
            </div>
            {touched && phoneBad && <p id={ids.error} className="field-error" role="alert">{t.phoneLength}</p>}
            <p id={ids.hint} className="hint">{t.phoneHint}</p>
            <label className={`check${number ? "" : " disabled"}`}>
              <input type="checkbox" checked={!!number && optIn} disabled={!number} onChange={(e) => { setOptIn(e.target.checked); setStatus(""); }} />
              <span>{t.phoneOptIn}</span>
            </label>
          </>
        )}</Field>
        <div className="details-actions">
          <button type="submit" className="btn primary" disabled={busy}>{t.saveDetails}</button>
          {me.phone && <button type="button" className="btn ghost" disabled={busy} onClick={() => void removeNumber()}>{t.removeNumber}</button>}
          <span className="status" role="status" aria-live="polite">{status}</span>
        </div>
      </form>
    </section>
  );
}

function AccountCard() {
  const store = useStore();
  const [confirming, setConfirming] = useState(false);
  return (
    <section className="profile-card account-card" aria-label={t.accountActions}>
      <div className="account-actions">
        <button type="button" className="btn" onClick={() => void signOut(store)}><SignOutIcon /><span>{t.signOut}</span></button>
        <button type="button" className="btn danger" onClick={() => setConfirming(true)}><TrashIcon /><span>{t.deleteAccount}</span></button>
      </div>
      <DeleteDialog open={confirming} onClose={() => setConfirming(false)} />
    </section>
  );
}

/** Type-to-confirm before the account and everything kept with it is deleted. */
function DeleteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useStore();
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  useEffect(() => {
    const d = ref.current!;
    if (open && !d.open) { setTyped(""); d.showModal(); quietFocus(d); }
    else if (!open && d.open) d.close();
  }, [open]);
  const ok = typed.trim().toUpperCase() === t.deleteWord;
  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    const done = await deleteAccount(store);
    setBusy(false);
    if (done) onClose();
  };
  return (
    <dialog ref={ref} className="dialog" aria-labelledby="deleteTitle" onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}>
      {open && (
        <form onSubmit={(e) => void confirm(e)}>
          <h3 id="deleteTitle">{t.deleteTitle}</h3>
          <p className="muted">{t.deleteText}</p>
          <label htmlFor={inputId} className="label">{t.deleteType(t.deleteWord)}</label>
          <input id={inputId} type="text" className="input" autoComplete="off" autoCapitalize="characters" spellCheck={false}
            value={typed} onChange={(e) => setTyped(e.target.value)} />
          <div className="dialog-actions">
            <button type="button" className="btn" disabled={busy} onClick={onClose}>{t.cancel}</button>
            <button type="submit" className="btn danger-fill" disabled={!ok || busy}>{busy ? t.deleting : t.deleteConfirm}</button>
          </div>
        </form>
      )}
    </dialog>
  );
}
