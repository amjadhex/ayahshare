// The translation picker, one for every place a translation is chosen (the editor's Language tool, the default
// translation in Preferences). Two steps (GroupedPicker.tsx): the language first (My language first, how many
// translations each has), then that language's translations with their short names, the full name under them, a
// "Voice" badge where a recorded voice reads the translation and the language's default marked. Pinned above the
// languages: the choices that belong to none (Preferences: "My language default"; "Arabic only").
import { useMemo } from "react";
import type { Edition } from "../design";
import { translationFor } from "../lang";
import { t } from "../strings";
import { byLanguage, canonicalEdition, editionOf, languageName, shortTranslationName } from "../translations";
import { isVoiced } from "../voice";
import { GroupedPicker, LangName, type PickGroup, type PickItem } from "./GroupedPicker";
import { useAppState } from "./hooks";

export { LangName };

/** A choice besides the translations (Preferences: "My language default"). */
export interface PickerOption { value: string; label: string; detail?: string }

/** A translation as a row: its short name, the full name under it when that is longer, and its badges. */
export function translationItem(e: Edition, defaultLabel = t.trDefault): PickItem {
  const short = shortTranslationName(e);
  const isDefault = e.identifier === translationFor(e.language), voiced = isVoiced(e.identifier);
  return {
    id: e.identifier,
    name: short,
    detail: e.englishName !== short ? e.englishName : e.name !== short ? e.name : undefined,
    lang: e.language,
    search: [e.englishName, e.name],
    badges: isDefault || voiced ? (
      <>
        {isDefault && <span className="trp-badge">{defaultLabel}</span>}
        {voiced && <span className="trp-badge trp-voice">{t.trVoice}</span>}
      </>
    ) : undefined,
  };
}

export function TranslationPicker({ value, onChange, extra = [], allowNone = true, label, onPicked }: {
  value: string;
  onChange: (value: string) => void;
  extra?: PickerOption[];
  allowNone?: boolean;
  /** The radio group's name for screen readers (the language's name is added). */
  label: string;
  /** After a pick by tap, click, Space or Enter (not by arrow keys): Preferences closes its sheet. */
  onPicked?: () => void;
}) {
  const { editions, lang } = useAppState();
  const groups = useMemo<PickGroup[]>(
    () => byLanguage(editions, translationFor).map((g) => ({ ...g, items: g.editions.map((e) => translationItem(e)) })), [editions]);
  const current = canonicalEdition(value);
  const pinned: PickItem[] = extra.map((o) => ({ id: o.value, name: o.label, detail: o.detail }));
  if (allowNone) {
    pinned.push({ id: "none", name: t.noTranslation, detail: t.trArabicOnly, badges: translationFor(lang) === "none" ? <span className="trp-badge">{t.trDefault}</span> : undefined });
  }
  // While the list loads: the current choice and None.
  if (!groups.length && value !== "none" && !extra.some((o) => o.value === value)) pinned.unshift({ id: value, name: value });
  return (
    <GroupedPicker groups={groups} value={current} mine={lang} label={label} searchLabel={t.trSearch} noun={t.trCount} nothingFound={t.trNothingFound}
      pinned={pinned} loading={t.translationsLoading} onDone={onPicked} onPick={(id) => onChange(id)} />
  );
}

/** The name of a translation choice, for buttons and hints: its short name, then its language when that is not My
 *  language. */
export function editionLabel(value: string, editions: Record<string, Edition>, lang?: string) {
  if (value === "none") return t.noTranslation;
  const e = editionOf(editions, value);
  if (!e) return value;
  return e.language === lang ? shortTranslationName(e) : `${shortTranslationName(e)} · ${languageName(e.language).english}`;
}
