---
name: anki-context
description: "Use when importing 微语境闪卡 notes into Anki via AnkiConnect."
version: 1.0.0
platforms: [macos, linux]
metadata:
  hermes:
    tags: [anki, ankiconnect, vocabulary, tts, minimax, import]
    category: education
    related_skills: [anki-card-template-design]
---

# Anki Context Importer

Import new, complete English vocabulary notes into the `微语境闪卡 1.0` note type through the Anki
collection available on AnkiConnect — without changing templates, styling, scheduling, or existing
notes. It is the sibling of the `AI多场景完型` importer (`anki-multiscene-importer`): same guards, same
MiniMax audio pipeline, different field contract. It covers two operations: **importing new words**
(`scripts/import-vocabulary.mjs`) and **rewriting cards that already exist** — content and audio, in
place, keeping the learner's scheduling (`scripts/rewrite-existing.mjs`).

`$SKILL_DIR` below means the directory containing this `SKILL.md`.

## Field contract (微语境闪卡 1.0)

| Field | Written by | Notes |
|---|---|---|
| `Word` `IPA` `ChineseCore` | input JSON | required, one word per note |
| `Sentence{i}` `Meaning{i}` `SentenceCN{i}` `Analysis{i}` | input JSON | 3–5 consecutive groups |
| `Theme` | input JSON | `bauhaus` (default) or `minimal` |
| `OtherMeanings` `Source` | input JSON | optional; `OtherMeanings` renders in a collapsed 其他义项 block |
| `WordAudio` `AudioSentence1..5` | **only the scripts** | raw MP3 filenames; never put them in input JSON |

Three things this note type expects that the sibling importer does not:

1. **Plain-text sentences — no `{{c1::...}}` cloze.** The templates render `{{Sentence1}}` as text and
   highlight the target word at render time with `mctxPattern()`. Cloze markup would appear verbatim.
   Every populated `Sentence{i}` must contain the `Word` or one of the inflections the template can
   derive (`delay` → `delayed`/`delaying`; multi-word phrases may be joined by `-`). The importer
   enforces exactly that.
2. **No separate `PartOfSpeech` field.** Carry the part of speech at the start of `ChineseCore` using
   abbreviations (`v. 修改，修订；更正`). Full English words such as `verb` are rejected.
3. **No `AudioWordAuto`, no `AudioMediaRefs`, no `[sound:...]` tags.** The back template plays
   word → sentence in sequence with its own JS player, so an Anki-native autoplay tag would play the
   word **twice**. `AudioSentence1..5` keep the sibling model's names; the word file goes to
   `WordAudio`, not `AudioWord`.

`Meaning{i}` is the sense *in that sentence* (the card's first-focus answer); `ChineseCore` is the
whole-word gloss. Do not duplicate one into the other.

What each side renders (as of the current templates): the **front** shows `Word`, `IPA` and one
`Sentence{i}` with the target word highlighted, plus manual speakers for the word and the sentence;
the **back** adds `ChineseCore`, the per-sentence `Meaning`, `SentenceCN`, `Analysis` and
`OtherMeanings`, and plays word → sentence automatically. So `Word`, `IPA` and `WordAudio` are now
visible card content, not just fields behind the answer.

## Before writing

1. Read [the note schema](references/note-schema.md), then [the context-design guide](references/example-design.md).
2. Confirm the user has authorized adding these notes. A request to draft, review, or validate
   vocabulary is not authorization to write to Anki.
3. Run `node "$SKILL_DIR/scripts/ensure-audio-fields.mjs"`. It is read-only. If it reports missing
   fields, stop and obtain authorization before running the printed `--apply` repair command.
4. **Mandatory content confirmation:** run the importer with `--dry-run`, then present the user with
   the word, IPA, Chinese gloss, and every sentence with its context meaning, translation, and
   analysis — in the user's own language. The dry-run also lists every token that sits above CEFR A2
   in a sentence: rewrite those sentences first (`references/example-design.md`), or exempt words the
   learner already knows in `assets/allow-extra.txt`. Do not generate TTS, write notes, or pass
   `--confirmed` until the user explicitly approves that content. Approving "add this word" or "use
   TTS" is not content approval.
5. Run the real import with `--confirmed` only after that approval. The script refuses unconfirmed
   imports before any paid TTS request or note write.

## Import

```sh
SKILL_DIR="/path/to/installed/anki-context"
node "$SKILL_DIR/scripts/import-vocabulary.mjs" /absolute/path/to/notes.json --dry-run --minimax-voice "English_Steady_Female_1"
node "$SKILL_DIR/scripts/import-vocabulary.mjs" /absolute/path/to/notes.json --confirmed --minimax-voice "English_Steady_Female_1"
```

AnkiConnect defaults to `http://127.0.0.1:8765`; override it with `ANKI_CONNECT_URL` or
`--anki-connect-url`. The note type defaults to `微语境闪卡 1.0`; set `modelName` in the JSON, or
`ANKI_CONTEXT_MODEL`, when the same template is installed under another name. The script requires the
existing model and deck and never creates or edits either. It validates 3–5 consecutive context
groups, rejects markup and sentences the template cannot highlight, rejects words already present in
the model, calls `canAddNotes`, adds notes, and reads every field back.

## Required MiniMax audio

Audio is on by default: `speech-2.8-hd`, `English_Steady_Female_1`, speed `1`, one request per word
plus one per populated sentence (four to six paid requests per uncached note). `--dry-run` reports how
many files already exist in the media collection and how many would be generated, so state that cost
before asking for confirmation. Read [the MiniMax guide](references/minimax-tts.md) first.

The key comes from `$MINIMAX_API_KEY`, the macOS Keychain item `anki-minimax-tts`, or a local `.env`.
Never put it in note JSON, card templates, Git, or chat. `--without-tts` is only for an explicitly
requested silent import; a missing voice or key is an import-blocking error, not permission to write a
silent card.

`synthesizeMiniMax()` resolves to `{ audioBase64, usageCharacters }` — **not** a Buffer. Pass
`audioBase64` straight to `storeMediaFile({ data })`, and refuse a payload below ~1000 base64 chars:
stringifying the object instead stores a 9-byte "[object Object]" file that Anki cannot play while
every existence-only check still passes.

Filenames are deterministic —
`<prefix>-<word-slug>-word|sentence-N-<sha256(text,model,voice,speed)[:16]>.mp3` — so a stopped import
resumes by reusing media instead of paying again. `--media-prefix` (default `minimax`) changes only
the prefix; audio generated by an older script variant carries a different fingerprint and is
generated again rather than reused.

To voice notes already in a deck:

```sh
node "$SKILL_DIR/scripts/add-audio-to-existing.mjs" --deck "测试::微语境闪卡" --minimax-voice "English_Steady_Female_1" --dry-run
```

It fills the audio fields of notes whose audio is empty, verifies afterwards that every stored
filename really exists in the media collection, and leaves notes that already have audio alone —
`--refresh` is required to replace audio whose filename no longer matches the current sentence text.

If AnkiConnect is unavailable, stop and ask the user to open Anki with AnkiConnect enabled. Never add
a fallback that writes collection files directly, and never expose an AnkiConnect endpoint publicly to
make a remote agent work.

## After writing

Report the imported words and note IDs. Script readback is persistence verification, not visual QA.
Do not trust the script's own summary alone. `scripts/verify-import.mjs` re-checks a deck (or one
`--word`) straight from AnkiConnect:

```sh
node "$SKILL_DIR/scripts/verify-import.mjs" --deck "测试::微语境闪卡"
node "$SKILL_DIR/scripts/verify-import.mjs" --deck "测试::微语境闪卡" --word incur
```

Per note it checks:

1. `notesInfo` on the new note: every input field matches, the populated `WordAudio` /
   `AudioSentence{i}` are filled, and the unpopulated audio slots are empty strings.
2. `findCards`/`cardsInfo`: exactly one card, in the intended deck.
3. Every stored filename exists — `retrieveMediaFile` returns true, and the file is on disk under
   `collection.media` with a non-zero size (a word clip is ~6–16 KB, a sentence ~20–70 KB).
4. **Answer-leak check on the rendered question:** `cardsInfo[].question` must contain the sentence
   and the hidden audio path, and must NOT contain the translation, the per-sentence `Meaning`, or
   the `Analysis`. A front template that renders an answer field is the one mistake that ruins the
   card silently.

To show the user how the card really renders, wrap the `question` / `answer` HTML from `cardsInfo` in
`<html><head><meta charset="utf-8"></head><body class="card">…</body></html>` and screenshot it in
headless Chromium: that HTML already carries the note type's CSS, so the result is the real card. The
front's shuffle bag picks a sentence with `Math.random`, so seed `localStorage`
(`mctx:<word>:<valid-slots>:pool`, e.g. `[1]`) in the head to pin a specific sentence for the shot.

Two traps in the leak check, both hit in practice: the question payload embeds the whole stylesheet,
so strip `<style>` and `<script>` before scanning for answer text (the CSS comments name the answer
fields and produce false positives), and compare **full** field values — an `Analysis` line normally
quotes the collocation that is already visible in the sentence. Also note the front DOM contains
every `Sentence{i}` slot and reveals one with JS, so "which sentence is showing" can only be checked
visually, never by counting strings in the HTML.

## Rewriting cards that already exist

When the user wants an existing card re-done — new sentences, a different difficulty rule, fixed
Chinese — rewrite it instead of deleting and re-importing: scheduling, tags and review history stay
put. Write the new content in the same JSON schema as an import (only the fields you want to change),
then:

```sh
node "$SKILL_DIR/scripts/rewrite-existing.mjs" /absolute/path/rewrite.json --deck "测试::微语境闪卡" --dry-run
node "$SKILL_DIR/scripts/rewrite-existing.mjs" /absolute/path/rewrite.json --deck "测试::微语境闪卡" --confirmed --minimax-voice "English_Steady_Female_1"
```

- It matches notes by `Word` **inside `--deck` only**, and refuses a word that is not there: this
  script never creates notes — use the importer for new words.
- The same `note-rules.mjs` validation and A2 gate as the importer run first, and the mandatory content
  confirmation applies identically: `--dry-run` → user approves → `--confirmed`.
- Audio filenames are content-addressed, so an unchanged sentence keeps its clip and only the edited
  ones are re-recorded (`"state": "reuse"` vs `"state": "new"` in the plan). Context slots beyond the
  new count are cleared and their clips deleted.
- Before writing it drops a field snapshot into `~/.hermes/cache/anki-context/backups/` (that file is
  the rollback), and deletes media only after checking that no other note in the model still uses it.
- After writing it reads every field back and checks each audio filename is in the media collection; a
  single mismatch fails the run. Then verify independently with `verify-import.mjs`.
- `--without-tts` cannot be combined with `--confirmed`: changed content with stale audio would leave
  the card playing speech that no longer matches its sentences.

## Tests

`tests/acceptance.sh` is the acceptance suite (33 checks). It is read-only against the user's decks:
the happy path runs `--dry-run`, the confirmation-gate test runs `--without-tts` without `--confirmed`,
and the audio/rewrite planning tests use `--dry-run`. It covers syntax, the audio-field audit, the
dry-run payload, every rejection rule (no target word, cloze markup, incomplete or non-consecutive
groups, unknown `Theme`, full-English part of speech, duplicate word), the refusal to import without
`--confirmed`, the A2 gate (`--strict-level`, `--no-level-check`, an A2-clean note), and the rewrite
planner (no-change plan, audio reuse, unknown word refused).

Its Anki-touching checks provision their own fixture note in `测试::anki-context验收` (imported with
real MiniMax audio on the first run) and drive everything through that card, so the suite keeps
working when the learner deletes or edits cards in their own decks:

```sh
bash "$SKILL_DIR/tests/acceptance.sh"
```

## Files

```text
SKILL.md
references/note-schema.md      字段契约（必填/可选/音频字段、内容约定）
references/example-design.md   3–5 个微语境的设计标准、A2 难度规则与自查清单
references/minimax-tts.md      语音配置、命名/复用规则、确认门
scripts/import-vocabulary.mjs        新建卡片（--dry-run / --confirmed）
scripts/rewrite-existing.mjs         改写已有卡片：内容+语音，保留排程（--deck / --dry-run / --confirmed）
scripts/add-audio-to-existing.mjs    给已有卡片补语音（--deck / --word / --refresh / --dry-run）
scripts/ensure-audio-fields.mjs      语音字段只读体检（--apply 修复）
scripts/verify-import.mjs            独立验收：字段/媒体/单卡/正面无答案泄漏（--deck / --word）
scripts/note-rules.mjs               内容规则单一来源（导入与改写共用同一套校验）
scripts/level-check.mjs              A2 难度校验：CEFR 词表 + 屈折展开 + 自备白名单
assets/cefr-j-words.tsv               CEFR-J/Octanove 词表（7035 词条，含等级）
assets/allow-extra.txt                自备白名单：你已掌握的专业词，不触发 A2 警告
assets/irregular-forms.txt            不规则变化（made/found/meant…）不算超纲
scripts/minimax-tts.mjs              TTS 调用与确定性文件名
scripts/minimax-credentials.mjs      key：env → Keychain → .env
tests/acceptance.sh                  验收套件（33 项；只写 测试::anki-context验收 夹具牌组）
agents/openai.yaml, .env.example, .gitignore
```
