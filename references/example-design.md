# Context design for retrieval

The front shows the word, its IPA and **every** sentence at once, each with the target word highlighted
inside it. The back leads with the whole-word gloss (`ChineseCore`, large) and puts each group's
translation under its sentence, with the word-for-word equivalent underlined and that group's
`Meaning{i}` as the tooltip. So the useful question is not "how many examples can I write" but
"**which different conditions make me retrieve this word**". Use three to five `Sentence{i}` groups;
each group is a distinct retrieval condition with its own one-line `Meaning{i}`.

Because all contexts are visible in one glance, weak differentiation is now *more* exposed than it was:
two near-identical rows sit next to each other instead of appearing on separate days.

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
   This one is now machine-checked: two identical `Meaning{i}` values are rejected before anything is
   written, and a pair of sentences whose content-word skeletons overlap by ≥3 words at ≥75% comes
   back as a `--dry-run` warning. Treat that warning like an A2 flag — rewrite one of the two, do not
   import past it.
6. **Fast to review.** Prefer one natural sentence of roughly 8–15 English words, at most ~160
   characters; the importer warns past that. Keep the target form inside the sentence — the template
   finds it with `mctxPattern()` and renders nothing highlighted if it cannot.

## Selection order

Cover the high-frequency, natural usage first, then breadth. The `--dry-run` preview carries
`dictionary.senses` — ECDICT's Chinese glosses for the word, which its sources already order by
commonness. Use that as the starting point: the first context should sit on a gloss near the front of
that list, and a sense that appears late (or only under a `[计]` / `[法]` / `[经]` domain tag) has to
earn its place against the interference it adds. It is a cross-check, not a ranking of the card's own
wording, and it never replaces the A2 sentence rule.
For polysemous words take the central
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
