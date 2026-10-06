# Note schema

Top-level JSON:

```json
{
  "modelName": "微语境闪卡 1.0",
  "deckName": "all in one::微语境闪卡",
  "tags": ["微语境"],
  "notes": [{ "Word": "..." }]
}
```

`modelName` is optional and defaults to `微语境闪卡 1.0` (`ANKI_FLASHCARD_MODEL` overrides the default);
set it when the same template is installed under a different note-type name. `tags` is optional and
defaults to `["微语境"]`. The AnkiConnect endpoint is configured outside this JSON with
`ANKI_CONNECT_URL` or `--anki-connect-url`.

Each note must include these non-empty string fields:

```text
Word, IPA, ChineseCore,
Sentence1, Meaning1, SentenceCN1, Analysis1,
Sentence2, Meaning2, SentenceCN2, Analysis2,
Sentence3, Meaning3, SentenceCN3, Analysis3
```

`Sentence4`, `Meaning4`, `SentenceCN4`, `Analysis4` and the corresponding group 5 are optional.
Include either all four fields of a group or none of them, and keep the groups consecutive: a note may
contain groups 1–3, 1–4, or 1–5, never group 5 without group 4.

`Theme` is optional. Omit it or set it to `bauhaus` for the default Bauhaus visual style; set it to
`minimal` for the plain blue style. No other values are accepted. The importer writes `bauhaus` when
the field is omitted or empty.

`OtherMeanings` (其他义项, shown in a collapsed block on the back) and `Source` (free-form provenance)
are optional strings. Leave them out when they add nothing.

When the model has audio enabled it also contains these fields. **Do not put values in them in the
input JSON** — the importer fills them only when MiniMax TTS is enabled:

```text
WordAudio, AudioSentence1, AudioSentence2, AudioSentence3, AudioSentence4, AudioSentence5
```

`WordAudio` and each populated `AudioSentence{i}` hold the raw MP3 filename that the templates load
into their own audio players. This note type deliberately has **no** `AudioWordAuto` / `AudioMediaRefs`
fields: the back template already plays word → sentence in sequence, so an Anki-native `[sound:...]`
autoplay tag would play the word twice.

## Content conventions

- `ChineseCore` carries the whole-word gloss and opens with an abbreviated part of speech:
  `v. 修改，修订；更正`, `n. 装箱单（逐箱列明内容的单证）`, `v. 遵守，符合（规定、标准、要求）`.
  Use `n.`, `v.`, `adj.`, `adv.`, `prep.`, `pron.`, `conj.`, `det.`, `aux.`, `phr.`, and ` / `
  between multiple roles. Full English words (`noun`, `verb`, …) are rejected, and the field must
  contain Chinese.
  The dry-run compares the part of speech you declare with ECDICT's tags for that word
  (`scripts/lexicon.mjs`) and warns when the word is never labelled with it — a warning, not a veto:
  ECDICT aggregates several dictionaries.

  **Standing rule — `ChineseCore` is dictionary-first.** The `--dry-run` preview carries
  `dictionary.core`: the ECDICT gloss string cleaned for card use (domain-tagged chunks like
  `[计]`/`[经]` dropped, `(xxx 的复数)` meta text dropped, `a.`→`adj.` and `vt/vi`→`v.`
  canonicalised, same-part-of-speech groups merged, senses kept in dictionary order, which is order
  by commonness). Treat that string as the **floor**: write the field in your own wording, but every
  sense in the floor must survive it — you may add senses the card's contexts need (the dictionary is
  often incomplete: `afford` lists three, the card needs 抽得出时间 and 承担得起后果 too), you may
  reword, you may not delete. When `dictionary.usable` is false the dictionary cannot carry the field —
  `dictionary.reason` says why (too few characters, or a phrasal entry with no part of speech such as
  `comply with` = 照做) — then write it yourself and say so in the confirmation. Never paste the raw
  dictionary string: it is machine-aggregated and carries wrong-sense noise (`nervousness` includes
  简练, 刚劲). Nothing checks the floor automatically — an experiment showed any character-overlap test
  flags legitimate rewording (颤抖 vs 战栗) — so the two strings are shown side by side and you confirm
  them.
- `Meaning{i}` is the sense of the target word **in that sentence only** — one short Chinese line
  (`把（经费）划拨给……；分配`). It is the card's first-focus answer, so do not restate the whole-word
  gloss or write a second translation of the sentence.
- `IPA` is rendered on the front right next to the word, so keep the slashed form
  (`/ɪnˈkɜːr/`). A bare or missing pronunciation is visible card content now, not a hidden detail.
  The dry-run also folds KK/DJ apart and warns when the string is far from ECDICT's phonetic; words
  whose phonetic is too short to compare, or missing from the table, are left alone.
- `SentenceCN{i}` is the Chinese translation of the whole sentence.
- `Analysis{i}` is the collocation/usage note in Chinese, optionally quoting the English pattern
  (`allocate A to B：把 A 分配给 B`).
- Each populated `Sentence{i}` must be **plain text** containing the `Word` or an inflection the
  template can derive. No cloze markup, no HTML, no `[sound:...]`, no JavaScript. The importer stores
  supplied text as fields and never alters card templates.
- Each populated `Sentence{i}` must stay inside **CEFR A2 apart from the target word**, so the learner
  can read it without a second unknown word. The importer prints the offending tokens with their CEFR
  band as warnings; `--strict-level` makes them a blocking error. Words the learner already knows can
  be listed in `assets/allow-extra.txt`.
- Keep sentences to roughly 8–15 English words. The template renders them at a
  ~30-character measure on wide screens, so very long sentences turn into tall cards.

For how to choose the three to five contexts, read [example-design.md](example-design.md).
