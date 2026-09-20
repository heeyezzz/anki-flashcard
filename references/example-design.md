# Context design for retrieval

The front shows the word, its IPA and **one** sentence with the target word highlighted inside it.
The back adds the meanings, the translation and the analysis. So the useful
question is not "how many examples can I write" but "which different conditions make me retrieve this
word". Use three to five `Sentence{i}` groups; each group is a distinct retrieval condition with its
own one-line `Meaning{i}`.

## Required qualities

1. **Strongly distinct situations.** Do not merely swap a subject, location, or vehicle. Use genuinely
   different domains or communicative purposes — a contract clause, a customer email, a customs
   query, a meeting, an everyday conversation, a news report. The card has no separate scene field, so
   the situation has to be legible from the sentence itself.
2. **Precise, non-spoiling clues.** The surrounding words should make the target word the clearly best
   answer without defining it. Avoid frames where many unrelated words fit.
3. **Everything except the target word stays inside CEFR A2.** This is a hard content rule for this
deck: the learner must be able to read the whole sentence without meeting a second unknown word.
   Concretely:
   - vocabulary: A1/A2 words only. No B1+ business nouns (`penalty`, `clause`, `inspection`,
     `shipment`), no nominalizations where a plain verb exists (`reimbursement` → `pay back`), no
     idioms or phrasal verbs outside A2;
   - grammar: present/past simple, present continuous, `can / will / must / may`, one clause plus at
     most one simple subordinate clause; no perfect continuous, no inversion, no long passives;
   - the situation can still be a work situation — say it with A2 words.
   `scripts/level-check.mjs` (used by the importer and the verifier) flags every token outside A2
   with its CEFR band, so read the `--dry-run` warnings and rewrite before importing. Terms the
   learner already commands can be exempted in `assets/allow-extra.txt`; an empty file is the strict
   rule. `--strict-level` turns any remaining flag into an error that blocks the import.
4. **Useful variation in use.** Across the selected contexts, vary what is real and common: a
   high-frequency sense, a collocation, a grammatical form (passive, participle, plural), or a
   sentence function (request, condition, obligation). Do not reach for rare or specialist senses just
   to make the sentences differ.
5. **Each `Meaning{i}` is the sense in that sentence.** `allocate` may be 划拨（经费） in one sentence,
   留出（时间） in another, 分派（职责） in a third. If two contexts would print the same `Meaning`,
   they are probably the same retrieval condition — merge or replace one.
6. **Fast to review.** Prefer one natural sentence of roughly 8–15 English words, at most ~160
   characters; the importer warns past that. Keep the target form inside the sentence — the template
   finds it with `mctxPattern()` and renders nothing highlighted if it cannot.

## Selection order

Cover the high-frequency, natural usage first, then breadth. For polysemous words take the central
sense, then add another sense only if it is common enough to repay the extra interference. Vary one
meaningful dimension per context — situation, collocation, sense, grammatical form, or sentence
function — not surface wording.

## Final review checklist

Before importing, verify every populated context:

- sounds natural in the situation it implies;
- is recognizably a different situation or a different use from the other contexts;
- contains enough contextual evidence to infer the target form;
- keeps the target word as the only real difficulty — every other word is A1/A2 (the dry-run reports
  any token that is not);
- prints a `Meaning{i}` that is specific to that sentence, not a restatement of `ChineseCore`;
- and collectively forms a high-frequency usage network for the word rather than five paraphrases of
  one sentence.
