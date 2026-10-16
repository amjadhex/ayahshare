"""Own reciters: a recitation published only as whole-surah MP3s, cut into one file per ayah for the app (which plays
and times every ayah on its own, like the everyayah.com folders). First: Sheikh Badr Al-Turki (owner, 16 Oct 2026;
mp3quran.net read 254, Hafs 'an 'Asim, murattal; the owner approved using it).

How an ayah is found: CTC forced alignment of the Arabic text (alquran.cloud quran-simple-clean) against the audio,
with an Arabic wav2vec2 model (jonatasgrosman/wav2vec2-large-xlsr-53-arabic). Ayahs are aligned one after another:
each window holds the ayah and the next one, so the boundary between them is fixed by both; the cut goes in the
quietest moment of the gap between the ayah's last letter and the next one's first. Leading and trailing silence is
trimmed to a short pause. The basmala before ayah 1 (every surah but 1 and 9) and an opening isti'adha are aligned too
and left out, as in the everyayah files (2:1 has no basmala; 1:1 is the basmala).

  python own_reciter.py fetch               download the surah files (resumable)
  python own_reciter.py cut [surah ...]     align and cut into out/<id>/ayahs/SSSAAA.mp3 (+ out/<id>/cuts.json)
  python own_reciter.py qa                  list the ayahs whose alignment looks weak (out/<id>/qa.json)
  python own_reciter.py verify [surah ...]  transcribe every ayah file and compare its start and end with the text
                                            (out/<id>/verify.json: the files whose words do not match)
  python own_reciter.py fix REF ...         move the start of each ayah (and the end of the one before) to where its
                                            first words are heard (a qari who goes back and repeats, an isti'adha)
  python own_reciter.py upload              upload the ayah files to R2 audio/<id>/SSSAAA.mp3 (resumable)
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

from common import OUT, log

RECITER = {"id": "badr_alturki", "source": "https://cdn.mp3quran.net/audio/badr-turki/r1/{s:03d}.mp3"}
MODEL = "jonatasgrosman/wav2vec2-large-xlsr-53-arabic"
SR = 16000
FPS = 50  # wav2vec2 frames per second (320-sample stride)
DIR = OUT / RECITER["id"]
BASMALA = "بسم الله الرحمن الرحيم"
ISTIADHA = "أعوذ بالله من الشيطان الرجيم"


# ---------- audio ----------

def load_audio(path, sr=SR):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def frame_energy(audio):
    """dB per 20 ms frame (same grid as the model's frames)."""
    n = len(audio) // (SR // FPS)
    frames = audio[: n * (SR // FPS)].reshape(n, -1)
    return 10 * np.log10(np.mean(frames ** 2, axis=1) + 1e-10)


# ---------- model ----------

_model = None


def model():
    global _model
    if _model is None:
        import torch
        from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor
        dev = "mps" if torch.backends.mps.is_available() else "cpu"
        _model = (Wav2Vec2Processor.from_pretrained(MODEL), Wav2Vec2ForCTC.from_pretrained(MODEL).to(dev).eval(), dev)
    return _model


def emissions(audio, chunk_s=30, ctx_s=2):
    """Log-probabilities per frame (T, vocab), computed in chunks with context on both sides."""
    import torch
    proc, m, dev = model()
    chunk, ctx = chunk_s * SR, ctx_s * SR
    out = []
    for start in range(0, len(audio), chunk):
        a, b = max(0, start - ctx), min(len(audio), start + chunk + ctx)
        x = proc(audio[a:b], sampling_rate=SR, return_tensors="pt").input_values.to(dev)
        with torch.no_grad():
            lp = torch.log_softmax(m(x).logits[0].float(), dim=-1).cpu().numpy()
        lo = (start - a) // (SR // FPS)
        hi = lo + (min(start + chunk, len(audio)) - start) // (SR // FPS)
        out.append(lp[lo:hi])
    em = np.concatenate(out)
    n = len(audio) // (SR // FPS)
    return em[:n] if len(em) >= n else np.pad(em, ((0, n - len(em)), (0, 0)), constant_values=-30.0)


def tokens(text):
    """Token ids of a text: letters the model knows, '|' between words."""
    vocab = model()[0].tokenizer.get_vocab()
    words = ["".join(ch for ch in w if ch in vocab) for w in text.replace("﻿", "").split()]
    ids = []
    for w in (w for w in words if w):
        if ids:
            ids.append(vocab["|"])
        ids.extend(vocab[ch] for ch in w)
    return ids


def greedy(em):
    proc = model()[0]
    ids = np.argmax(em, axis=1)
    out, prev = [], -1
    for i in ids:
        if i != prev and i != proc.tokenizer.pad_token_id:
            out.append(int(i))
        prev = i
    return proc.tokenizer.decode(out)


# ---------- alignment ----------

def align(em, ids):
    """CTC Viterbi of `ids` over `em`, free end. Returns (first frame, last frame) of each token and the mean log-prob of
    the frames the tokens hold, or None when the window is too short."""
    blank = model()[0].tokenizer.pad_token_id
    labels = np.full(2 * len(ids) + 1, blank, dtype=np.int64)
    labels[1::2] = ids
    S, T = len(labels), len(em)
    if T < len(ids):
        return None
    skip = np.zeros(S, dtype=bool)
    skip[3::2] = labels[3::2] != labels[1:-2:2]
    NEG = -1e9
    score = np.full(S, NEG)
    score[0], score[1] = em[0, labels[0]], em[0, labels[1]]
    back = np.zeros((T, S), dtype=np.int8)
    best_end, best_t, best_s = NEG, 0, S - 1
    for t in range(1, T):
        stay = score
        step = np.concatenate(([NEG], score[:-1]))
        jump = np.where(skip, np.concatenate(([NEG, NEG], score[:-2])), NEG)
        stacked = np.stack([stay, step, jump])
        choice = np.argmax(stacked, axis=0)
        score = stacked[choice, np.arange(S)] + em[t, labels]
        back[t] = choice
        end_s = S - 1 if score[-1] >= score[-2] else S - 2
        # Free end: the best place to have finished, per frame (else ending early always wins).
        if score[end_s] / (t + 1) > best_end:
            best_end, best_t, best_s = score[end_s] / (t + 1), t, end_s
    path = np.zeros(best_t + 1, dtype=np.int64)
    s = best_s
    for tt in range(best_t, -1, -1):
        path[tt] = s
        s -= int(back[tt, s]) if tt > 0 else 0
    first = np.full(len(ids), -1)
    last = np.full(len(ids), -1)
    for tt, st in enumerate(path):
        if st % 2 == 1:
            k = st // 2
            if first[k] < 0:
                first[k] = tt
            last[k] = tt
    if (first < 0).any():
        return None
    held = [em[tt, labels[st]] for tt, st in enumerate(path) if st % 2 == 1]
    return first, last, float(np.mean(held))


# ---------- cutting ----------

def surah_units(surah, ayahs, opening):
    """[(name, text)]: the opening (isti'adha) if heard, the basmala where it is recited before ayah 1, then the ayahs."""
    units = [("istiadha", ISTIADHA)] if opening else []
    if surah not in (1, 9):
        units.append(("basmala", BASMALA))
    for i, a in enumerate(ayahs, 1):
        text = a
        if i == 1 and surah not in (1, 9) and text.startswith(BASMALA[:3]):
            text = " ".join(text.split()[4:])  # alquran.cloud puts the basmala in front of ayah 1
        units.append((f"{surah}:{i}", text))
    return units


def cut_surah(surah, ayahs):
    src = DIR / "src" / f"{surah:03d}.mp3"
    audio = load_audio(src)
    em = emissions(audio)
    energy = frame_energy(audio)
    speech_db = np.percentile(energy, 90)
    quiet = energy < speech_db - 28
    opening = "عوذ" in plain(greedy(em[: 12 * FPS]))
    units = surah_units(surah, ayahs, opening)
    unit_ids = [tokens(t) for _, t in units]

    rate = 0.085 * FPS  # frames per token, learnt as we go
    t0 = 0
    spans, scores = [], []
    for k in range(len(units)):
        ids = unit_ids[k] + ([model()[0].tokenizer.get_vocab()["|"]] + unit_ids[k + 1] if k + 1 < len(units) else [])
        width = int(len(ids) * rate * 2.5 + 20 * FPS)
        win = em[t0: t0 + width]
        res = align(win, ids)
        while res is None or (k + 1 < len(units) and res[0][len(unit_ids[k])] < 0):
            width *= 2
            win = em[t0: t0 + width]
            res = align(win, ids)
            if width > len(em):
                break
        first, last, sc = res
        n = len(unit_ids[k])
        a, b = t0 + first[0], t0 + last[n - 1]
        if k + 1 < len(units):
            c = t0 + first[n + 1]  # first letter of the next unit (after the '|')
            gap = np.arange(b + 1, max(b + 2, c))
            cut = int(gap[np.argmin(energy[gap])]) if len(gap) else b + 1
        else:
            cut = b + 1
            while cut < len(energy) - 1 and not quiet[cut: cut + 8].all():
                cut += 1
        spans.append([int(a), int(b), int(cut)])
        scores.append(sc)
        rate = 0.8 * rate + 0.2 * max(1.0, (b - a + 1) / max(1, n))
        t0 = cut

    # One file per ayah: from the previous cut to its own, with at most 0.25 s of silence before and 0.4 s after.
    cuts = {}
    for k, (name, _) in enumerate(units):
        if ":" not in name:
            continue
        start = spans[k - 1][2] if k > 0 else max(0, spans[k][0] - FPS)
        end = spans[k][2]
        a, b = spans[k][0], spans[k][1]
        while a > start and not quiet[a - 1]:  # back to the start of the sound
            a -= 1
        while b < end - 1 and not quiet[b + 1: b + 6].all():  # on through a held last letter
            b += 1
        cuts[name] = {"start": max(start, a - FPS // 4) / FPS, "end": min(end, b + FPS * 2 // 5) / FPS, "score": round(scores[k], 3)}
    return cuts, opening


def encode(surah, cuts):
    src = DIR / "src" / f"{surah:03d}.mp3"
    wav = DIR / f"tmp_{surah:03d}.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-ar", "44100", str(wav)], check=True)
    out = DIR / "ayahs"
    out.mkdir(parents=True, exist_ok=True)
    for name, c in cuts.items():
        s, a = (int(x) for x in name.split(":"))
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{c['start']:.3f}", "-t", f"{c['end'] - c['start']:.3f}",
                        "-i", str(wav), "-af", "afade=t=out:st=%.3f:d=0.05" % max(0, c["end"] - c["start"] - 0.05),
                        "-c:a", "libmp3lame", "-b:a", "128k", str(out / f"{s:03d}{a:03d}.mp3")], check=True)
    wav.unlink()


def quran():
    d = json.loads((DIR / "quran-simple-clean.json").read_text())["data"]["surahs"]
    return {s["number"]: [a["text"] for a in s["ayahs"]] for s in d}


def cmd_cut(surahs):
    q = quran()
    path = DIR / "cuts.json"
    allcuts = json.loads(path.read_text()) if path.exists() else {}
    for s in surahs or range(1, 115):
        if not (DIR / "src" / f"{s:03d}.mp3").exists():
            log(f"surah {s}: no source file")
            continue
        cuts, opening = cut_surah(s, q[s])
        encode(s, cuts)
        allcuts.update(cuts)
        path.write_text(json.dumps(allcuts, ensure_ascii=False, indent=0))
        worst = min(cuts.values(), key=lambda c: c["score"])
        log(f"surah {s}: {len(cuts)} ayahs, isti'adha {'yes' if opening else 'no'}, weakest score {worst['score']}")


def cmd_qa():
    cuts = json.loads((DIR / "cuts.json").read_text())
    q = quran()
    rows = []
    for name, c in cuts.items():
        s, a = (int(x) for x in name.split(":"))
        chars = len(q[s][a - 1].replace(" ", ""))
        rows.append({"ref": name, "score": c["score"], "sec": round(c["end"] - c["start"], 2), "sec_per_char": round((c["end"] - c["start"]) / max(1, chars), 3)})
    scores = np.array([r["score"] for r in rows])
    rates = np.array([r["sec_per_char"] for r in rows])
    lo, (r1, r2) = np.percentile(scores, 2), np.percentile(rates, [1, 99])
    weak = [r for r in rows if r["score"] < lo or r["sec_per_char"] < r1 or r["sec_per_char"] > r2]
    (DIR / "qa.json").write_text(json.dumps(weak, ensure_ascii=False, indent=0))
    print(f"{len(rows)} ayahs; score median {np.median(scores):.2f}, 2nd percentile {lo:.2f}; {len(weak)} flagged → qa.json")


def plain(text):
    """Letters only, no diacritics, hamza forms and alef maqsura folded (what an ASR guess and the text share)."""
    import re
    t = re.sub(r"[\u064b-\u0652\u0670\u0640\ufeff]", "", text)
    for a, b in (("أ", "ا"), ("إ", "ا"), ("آ", "ا"), ("ٱ", "ا"), ("ى", "ي"), ("ة", "ه"), ("ؤ", "و"), ("ئ", "ي")):
        t = t.replace(a, b)
    return re.sub(r"[^\u0621-\u064a]", "", t)


def cmd_verify(surahs):
    from difflib import SequenceMatcher
    q = quran()
    path = DIR / "verify.json"
    found = json.loads(path.read_text()) if path.exists() else {}
    for f in sorted((DIR / "ayahs").glob("*.mp3")):
        s, a = int(f.stem[:3]), int(f.stem[3:])
        if surahs and s not in surahs:
            continue
        ref = q[s][a - 1]
        if a == 1 and s not in (1, 9):
            ref = " ".join(ref.split()[4:])
        heard, want = plain(greedy(emissions(load_audio(f)))), plain(ref)
        n = min(12, len(want))
        head = SequenceMatcher(None, heard[: n + 4], want[:n]).ratio()
        tail = SequenceMatcher(None, heard[-(n + 4):], want[-n:]).ratio()
        whole = SequenceMatcher(None, heard, want).ratio()
        found[f"{s}:{a}"] = {"head": round(head, 2), "tail": round(tail, 2), "whole": round(whole, 2)}
    path.write_text(json.dumps(found, indent=0))
    bad = {k: v for k, v in found.items() if min(v["head"], v["tail"]) < 0.5}
    log(f"verified {len(found)} files; {len(bad)} with a start or end that does not match: {sorted(bad)[:40]}")


def cmd_fix(refs):
    """For each ref: search the span from the previous ayah's start to this ayah's end for the best start of this
    ayah's first words, and cut there. Re-encodes both files."""
    q = quran()
    path = DIR / "cuts.json"
    cuts = json.loads(path.read_text())
    for ref in refs:
        if ref.endswith(":end"):  # "50:32:end": the ayah ends after its own last word (the qari began the next one and went back)
            ref = ref[:-4]
            s, a = (int(x) for x in ref.split(":"))
            lo = cuts[ref]["start"]
            em = emissions(load_audio(DIR / "src" / f"{s:03d}.mp3")[int(lo * SR): int(cuts[ref]["end"] * SR)])
            res = align(em, tokens(q[s][a - 1] if a > 1 or s in (1, 9) else " ".join(q[s][a - 1].split()[4:])))
            end = lo + (res[1][-1] + FPS * 2 // 5) / FPS
            log(f"{ref}: end {cuts[ref]['end']:.2f} → {end:.2f}")
            cuts[ref]["end"] = end
            encode(s, {ref: cuts[ref]})
            continue
        s, a = (int(x) for x in ref.split(":"))
        prev = f"{s}:{a - 1}" if a > 1 else None
        # Ayah 1: from 12 s before (its first words may have gone to the basmala, which has no file).
        lo, hi = (cuts[prev]["start"] if prev else max(0.0, cuts[ref]["start"] - 12)), cuts[ref]["end"]
        text = q[s][a - 1]
        if a == 1 and s not in (1, 9):
            text = " ".join(text.split()[4:])
        ids = tokens(" ".join(text.split()[:4]))
        audio = load_audio(DIR / "src" / f"{s:03d}.mp3")
        em = emissions(audio[int(lo * SR): int(hi * SR)])
        best = (-1e9, 0)
        for off in range(0, max(1, len(em) - len(ids) * 3), 5):
            res = align(em[off: off + len(ids) * 12 + FPS], ids)
            # The first letter must come right at the offset (else a later start with the same words also fits).
            if res and res[0][0] <= 10 and res[2] > best[0]:
                best = (res[2], off)
        start = lo + max(0, best[1] - FPS // 5) / FPS
        log(f"{ref}: start {cuts[ref]['start']:.2f} → {start:.2f} (score {best[0]:.2f})")
        cuts[ref]["start"] = start
        if prev:
            cuts[prev]["end"] = start
        encode(s, {k: cuts[k] for k in (prev, ref) if k})
    path.write_text(json.dumps(cuts, ensure_ascii=False, indent=0))


def cmd_upload():
    """Through the Worker's ingest API (like ml_lalithasaram.py), 8 at a time; uploaded.txt makes it resumable."""
    import threading
    from concurrent.futures import ThreadPoolExecutor
    from common import put_media
    done_path = DIR / "uploaded.txt"
    done = set(done_path.read_text().split()) if done_path.exists() else set()
    files = [p for p in sorted((DIR / "ayahs").glob("*.mp3")) if p.name not in done]
    lock = threading.Lock()
    with open(done_path, "a") as f:
        def put(p):
            put_media(f"audio/{RECITER['id']}/{p.name}", p.read_bytes(), "audio/mpeg")
            with lock:
                f.write(p.name + "\n")
                f.flush()
        with ThreadPoolExecutor(8) as pool:
            list(pool.map(put, files))
    log(f"uploaded {len(files)} files ({len(done) + len(files)} in all)")


def cmd_fetch():
    (DIR / "src").mkdir(parents=True, exist_ok=True)
    for s in range(1, 115):
        dst = DIR / "src" / f"{s:03d}.mp3"
        if not dst.exists():
            subprocess.run(["curl", "-s", "-f", "--retry", "4", "-o", str(dst), RECITER["source"].format(s=s)], check=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["fetch", "cut", "qa", "verify", "fix", "upload"])
    ap.add_argument("surahs", nargs="*")
    args = ap.parse_args()
    {"fetch": cmd_fetch, "cut": lambda: cmd_cut([int(x) for x in args.surahs]), "qa": cmd_qa, "verify": lambda: cmd_verify([int(x) for x in args.surahs]), "fix": lambda: cmd_fix(args.surahs), "upload": cmd_upload}[args.cmd]()
