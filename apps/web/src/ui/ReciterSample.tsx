// A short sample of a reciter (Al-Fatiha 1:2), played from the reciter lists (Reels' My preferred reciter, All surahs)
// so people hear them before they choose (owner, 12 Oct 2026). One sample at a time; it stops when the list closes.
import { useCallback, useEffect, useRef, useState } from "react";
import { audioUrl } from "../api";
import { t } from "../strings";
import { PauseIcon, PlayIcon } from "./icons";
import "./reciter-sample.css";

const SAMPLE_SURAH = 1, SAMPLE_AYAH = 2;

/** `open`: the list is on screen (closing it stops the sample). `playing`: the reciter whose sample plays. */
export function useReciterSample(open: boolean) {
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const stop = useCallback(() => { audio.current?.pause(); setPlaying(null); }, []);
  useEffect(() => { if (!open) stop(); }, [open, stop]);
  useEffect(() => () => audio.current?.pause(), []);
  const toggle = (folder: string) => {
    if (playing === folder) return stop();
    const a = (audio.current ??= new Audio());
    a.onended = a.onerror = () => setPlaying(null);
    a.src = audioUrl(folder, SAMPLE_SURAH, SAMPLE_AYAH);
    setPlaying(folder);
    void a.play().catch(() => setPlaying(null));
  };
  return { playing, toggle, stop };
}

export function SampleButton({ name, playing, onClick }: { name: string; playing: boolean; onClick: () => void }) {
  return (
    <button type="button" className="sample-btn" aria-pressed={playing} aria-label={playing ? t.stopSample(name) : t.playSample(name)} onClick={onClick}>
      {playing ? <PauseIcon /> : <PlayIcon />}
    </button>
  );
}
