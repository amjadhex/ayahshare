# Ayah grouping review for a Quran share-video app

Users pick ONE ayah and the app makes a short video of it (Arabic + translation). Your job: for every ayah in
your chunk, decide whether the video may show it ALONE, or which consecutive ayahs (same surah) must come with it.

## The one rule
Group only when showing the ayah alone would **break or distort its meaning**. Otherwise it stays alone.

Group (must include neighbours) when, alone, the ayah:
1. **Is cut mid-sentence or mid-thought** so a viewer cannot follow it (107:4 "So woe to those who pray" needs
   107:5-7; 1:6 "Guide us to the straight path -" needs 1:7; an oath "By the dawn" with its answer far away).
2. **Misleads**: a threat, command or ruling without its condition, limit or exception that is in the neighbour
   (2:191 "kill them wherever you overtake them" needs 2:190-193; 24:4 needs the exception in 24:5; 9:5 needs 9:4-6).
3. **Puts someone else's words in God's mouth**: a quote of Pharaoh, Satan, disbelievers or hypocrites whose speaker
   is only named in the previous ayah (79:24 "I am your most exalted lord" needs 79:23-24 so the viewer sees Pharaoh
   said it). If the ayah itself names the speaker, it can stay alone.
4. **Has no meaning on its own**: isolated letters (Alif-Lam-Meem) or a fragment like "Racing ahead, their heads
   raised up" whose subject is in the neighbour.

Do NOT group when:
- The ayah is a complete, self-contained statement even if it relates to a theme around it (2:255, 2:286, 13:28,
  94:5, 39:53, 65:3 stand alone).
- A pronoun ("he", "they", "it") points back, but the ayah still reads as a true, non-misleading statement on its own.
- Neighbours would merely be "nice to have" context. The app has a separate "more context" button.

Ranges: the SMALLEST contiguous range that fixes the problem; usually 2-3 ayahs. Read backwards too (an ayah that
starts mid-sentence needs the ayah(s) before it). If the honest minimum is longer than 5 ayahs, give it anyway and set
`"long": true`. Every ayah inside a group should normally get the same range, unless one of them is itself complete
(e.g. in 13:27-28, 13:27 needs 13:28 but 13:28 stands alone).

## Input (your chunk file, JSONL, one ayah per line, in order)
- `en`: Sahih International translation. `waqf_end`: mushaf mark at the end of the Arabic ayah ("la" = reciters
  must not stop here, the meaning runs on; "stop" = complete; "none" = ordinary end).
- `rule_range` / `rule_flags`: what an automatic rule (English punctuation + waqf) proposed. It is often right about
  cut sentences but blind to meaning; override it freely.
- `muyassar_group` / `muyassar`: Tafsir al-Muyassar (Arabic, short). It explains some ayahs together; its text is
  given on the first ayah of its group. Use it to understand meaning, who is speaking, and what a pronoun refers to.
  A shared Muyassar group is a hint, not a rule.

## Output
Write `out_<chunk number>.jsonl` next to your chunk file, ONE line per input ayah, same order, no omissions:
`{"ref":"107:4","range":"107:4-7","why":"cut: woe to those who pray, heedless of it","unsure":false}`
- `range`: "s:a" when it stands alone, "s:a-b" otherwise (must contain the ref, same surah).
- `why`: at most 10 English words; "complete" is enough for clear standalone ayahs.
- `unsure`: true only when a careful scholar could reasonably decide either way.
- add `"long": true` when the range is longer than 5 ayahs.

Work through the chunk in order, in batches (read ~60 lines, append their output, continue) so nothing is skipped.
Judge each ayah on its own merits; be consistent. When done, reply with only: count written, count grouped, count unsure.
