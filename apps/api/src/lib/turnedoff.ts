// What the admin turned off (admin Library, migrations/0014_turned_off.sql): tafsirs, reciters and translation voices
// the app no longer offers. Read on every /api/config and tafsir request; a failed read (D1 down) turns nothing off.
import type { TurnedOff } from "../../../../contracts/types";

export type OffKind = "tafsir" | "reciter" | "voice";

export async function turnedOff(db: D1Database): Promise<TurnedOff> {
  const off: TurnedOff = { tafsirs: [], reciters: [], voices: [] };
  try {
    const { results } = await db.prepare("SELECT kind, id FROM turned_off").all<{ kind: OffKind; id: string }>();
    for (const r of results) off[`${r.kind}s`]?.push(r.id);
  } catch (e) {
    console.warn("turned_off unreadable:", String(e));
  }
  return off;
}
