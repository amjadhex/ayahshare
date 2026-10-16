# Second-pass review: doubtful ayah groupings, checked against tafsir

A Quran share-video app shows ONE ayah, or the smallest group of ayahs needed so the meaning is not broken. A first
reviewer already decided every ayah; the ayahs in your batch are about punishment, Hellfire, war or death. Judge ONLY the grouping (alone or which range), exactly as for any other ayah; do not judge whether the topic is suitable to share. Settle each with tafsir evidence.

## The rule (same as pass 1)
Group only when the ayah shown alone would break or distort its meaning:
1. cut mid-sentence/mid-thought (107:4 "So woe to those who pray" needs 107:5-7);
2. misleads: a threat, command or ruling without the condition, limit or exception in its neighbour (2:191 needs
   2:190-193; 24:4 needs 24:5);
3. someone else's words (Pharaoh, Satan, disbelievers) look like God's words because the speaker is only named in
   the neighbour (79:24 needs 79:23);
4. no meaning alone (isolated letters, a fragment whose subject is in the neighbour).
Otherwise it stays ALONE, even if a pronoun points back or the neighbour is related ("nice to have" context is not a
reason; the app has a separate context button). Ranges are the smallest contiguous range in the same surah.

## Evidence (use the quran MCP tools)
1. Load the tools once with ToolSearch: `select:mcp__quran__fetch_grounding_rules,mcp__quran__fetch_tafsir`.
2. Call `mcp__quran__fetch_grounding_rules` once and pass its nonce as `grounding_nonce` on every fetch.
3. For each ayah fetch `ar-jalalayn` for the ayah and its candidate range (it inserts the implied words: who is
   speaking, what a pronoun or clause attaches to). Fetch several refs per call (`ayahs` takes a list).
4. When Jalalayn does not settle it, fetch `ar-nathm-aldurar` (al-Biqa'i, on how each ayah connects to its
   neighbours) for that ayah only. It is long; read what concerns the link to the neighbouring ayah.
If a tool fails, decide from the English and neighbours and say so in `evidence`.

## Input: your batch file (JSONL)
`ref`, `ai_range` / `ai_why` (pass-1 decision), `rule_range` (automatic punctuation/waqf rule), `waqf_end` ("la" =
reciters must not stop at the end of this ayah), and the English of the ayah and two neighbours on each side.

## Output
Write `result_<batch number>.jsonl` next to the batch file, one line per input ayah, same order:
`{"ref":"79:24","range":"79:23-24","why":"Pharaoh's words; speaker named in 79:23","evidence":"jalalayn","unsure":false}`
- `range`: "s:a" (alone) or "s:a-b".  `why`: at most 12 English words.
- `evidence`: which source settled it: "jalalayn", "biqai", "both" or "text".
- `unsure`: true only if, after the tafsir, a careful scholar could still reasonably decide either way.
When done, reply with only: count written, count changed from ai_range, count still unsure.
