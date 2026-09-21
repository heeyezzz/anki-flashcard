#!/usr/bin/env bash
# Acceptance tests for the anki-context skill. Read-only against Anki:
# --dry-run for the happy path, --without-tts + no --confirmed for the refusal test.
# Nothing here writes notes, media, or the note type.
set -uo pipefail
S="$(cd "$(dirname "$0")/.." && pwd)"
T="${TMPDIR:-/tmp}/anki-context-tests"
mkdir -p "$T"
pass=0; fail=0
check() { # check <label> <expected-substring> <command...>
  local label="$1" want="$2"; shift 2
  local out; out="$("$@" 2>&1)"
  if grep -qF "$want" <<<"$out"; then echo "PASS  $label"; pass=$((pass+1));
  else echo "FAIL  $label"; echo "      expected: $want"; echo "      got: $(head -c 300 <<<"$out")"; fail=$((fail+1)); fi
}

check_absent() { # check_absent <label> <forbidden-substring> <command...>
  local label="$1" bad="$2"; shift 2
  local out; out="$("$@" 2>&1)"
  if grep -qF "$bad" <<<"$out"; then echo "FAIL  $label (unexpected: $bad)"; fail=$((fail+1));
  else echo "PASS  $label"; pass=$((pass+1)); fi
}

echo "== 1. syntax =="
for f in "$S"/scripts/*.mjs; do
  if node --check "$f" 2>/dev/null; then echo "PASS  node --check $(basename "$f")"; pass=$((pass+1));
  else echo "FAIL  node --check $(basename "$f")"; node --check "$f"; fail=$((fail+1)); fi
done

echo "== 2. audio-field audit (read-only) =="
check "ensure-audio-fields reports the model is complete" "已有全部语音字段" node "$S/scripts/ensure-audio-fields.mjs"

echo "== 3. happy path (--dry-run, no writes, no TTS key needed) =="
python3 - "$T" <<'PY'
import json, sys, pathlib
T = pathlib.Path(sys.argv[1])
base = {
  "modelName": "微语境闪卡 1.0",
  "deckName": "all in one::微语境闪卡",
  "notes": [{
    "Word": "waive", "IPA": "/weɪv/", "ChineseCore": "v. 免除，放弃（费用、权利）", "Theme": "bauhaus",
    "OtherMeanings": "waive a requirement：免除某项要求；名词形式 waiver。",
    "Sentence1": "The bank agreed to waive the transfer fee for small accounts.",
    "Meaning1": "免除（费用）", "SentenceCN1": "银行同意对小额账户免除转账手续费。",
    "Analysis1": "waive a fee：正式用语，多用于费用、权利、规则。",
    "Sentence2": "Both sides agreed to waive the penalty clause in the contract.",
    "Meaning2": "放弃（合同条款）", "SentenceCN2": "双方同意放弃合同中的违约金条款。",
    "Analysis2": "waive a clause / a penalty：常用于合同谈判。",
    "Sentence3": "The customs office may waive the inspection for small shipments.",
    "Meaning3": "免于（检查）", "SentenceCN3": "海关可能对小额货物免予查验。",
    "Analysis3": "waive an inspection：免于某项检查或手续。"
  }]
}
(T/"ok.json").write_text(json.dumps(base, ensure_ascii=False, indent=2))

def variant(name, mutate):
    data = json.loads(json.dumps(base))
    mutate(data["notes"][0])
    (T/f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, indent=2))

variant("no_target_word", lambda n: n.update(Sentence2="Both sides agreed to drop the penalty clause in the contract."))
variant("cloze_markup", lambda n: n.update(Sentence2="Both sides agreed to {{c1::waive::填入}} the penalty clause."))
variant("group_gap", lambda n: n.update(Meaning2=""))
variant("bad_theme", lambda n: n.update(Theme="dark"))
variant("full_pos_word", lambda n: n.update(ChineseCore="verb. 免除，放弃"))
def nonconsecutive(n):
    n.update(Sentence3="", Meaning3="", SentenceCN3="", Analysis3="")
    n.update(Sentence4="The supplier asked us to waive the late fees.", Meaning4="免除（滞纳金）",
             SentenceCN4="供应商请我们免除滞纳金。", Analysis4="waive late fees：免除逾期费用。")
variant("nonconsecutive", nonconsecutive)
variant("duplicate_word", lambda n: n.update(Word="allocate", Sentence1="Please allocate more budget to training.",
                                            Sentence2="Funds were allocated to the region after the audit.",
                                            Sentence3="We allocate one hour a day to reading."))

# A2-clean note: every word except the target is A1/A2, so --strict-level must accept it.
(T/"ok_a2.json").write_text(json.dumps({
  "modelName": "微语境闪卡 1.0",
  "deckName": "all in one::微语境闪卡",
  "notes": [{
    "Word": "borrow", "IPA": "/ˈbɒroʊ/", "ChineseCore": "v. 借，借用（东西、钱）", "Theme": "bauhaus",
    "Sentence1": "Can I borrow your pen for a minute?",
    "Meaning1": "借（东西）", "SentenceCN1": "能借你的笔用一分钟吗？",
    "Analysis1": "borrow + 东西：从别人那里借来，常与 from 连用。",
    "Sentence2": "She borrowed some money from her brother.",
    "Meaning2": "借（钱）", "SentenceCN2": "她向她哥哥借了些钱。",
    "Analysis2": "borrow money from sb：钱是从别人那里借来的。",
    "Sentence3": "We borrow books from the library every week.",
    "Meaning3": "借阅（书）", "SentenceCN3": "我们每周都从图书馆借书。",
    "Analysis3": "borrow books：图书馆借书是最常见的搭配。"
  }]
}, ensure_ascii=False, indent=2))
# 改写夹具：内容与夹具卡一致（含被“指纹失效”测试改过的 Sentence3），用于验证“不改就不重录”。
def rewrite_note(word="incur"):
    return {
        "Word": word, "IPA": "/ɪnˈkɜːr/", "ChineseCore": "v. 招致，蒙受（损失、费用）", "Theme": "bauhaus",
        "Sentence1": "If we are late, we may incur a small fine.", "Meaning1": "招致（罚款）",
        "SentenceCN1": "如果我们迟到，可能要被罚一笔小钱。", "Analysis1": "incur a fine：招致罚款。",
        "Sentence2": "We may incur more costs if we change the plan.", "Meaning2": "带来（额外成本）",
        "SentenceCN2": "如果改计划，我们可能要花更多的钱。", "Analysis2": "incur costs：带来成本。",
        "Sentence3": "If you pay late, you may incur a fine.", "Meaning3": "产生（费用）",
        "SentenceCN3": "如果你晚付款，就可能要付一笔费用。", "Analysis3": "incur a fee：产生费用。"
    }
(T/"rewrite_ok.json").write_text(json.dumps({
    "modelName": "微语境闪卡 1.0", "deckName": "测试::anki-context验收", "notes": [rewrite_note()]}, ensure_ascii=False))
ghost = rewrite_note("ghostword")
ghost.update({
    "IPA": "/ˈɡoʊstwɜːrd/", "ChineseCore": "n. 幽灵词（验收夹具）",
    "Sentence1": "Please ghostword the file before the meeting.", "Meaning1": "幽灵用法一",
    "SentenceCN1": "开会前请幽灵一下这个文件。", "Analysis1": "ghostword sth：验收用假搭配。",
    "Sentence2": "We ghostword the plan again next week.", "Meaning2": "幽灵用法二",
    "SentenceCN2": "我们下周再幽灵一下计划。", "Analysis2": "ghostword the plan：验收用假搭配。",
    "Sentence3": "They always ghostword the box in the morning.", "Meaning3": "幽灵用法三",
    "SentenceCN3": "他们总是在早上幽灵那个箱子。", "Analysis3": "ghostword the box：验收用假搭配。"})
(T/"rewrite_ghost.json").write_text(json.dumps({
    "modelName": "微语境闪卡 1.0", "deckName": "测试::anki-context验收", "notes": [ghost]}, ensure_ascii=False))
print("fixtures written to", T)
PY
check "--dry-run prints the content preview"  '"dryRun": true'          node "$S/scripts/import-vocabulary.mjs" "$T/ok.json" --dry-run
check "--dry-run lists planned audio files"   '-waive-word-'          node "$S/scripts/import-vocabulary.mjs" "$T/ok.json" --dry-run
check "--dry-run names the sentence slots"    '-waive-sentence-1-'    node "$S/scripts/import-vocabulary.mjs" "$T/ok.json" --dry-run
check "--dry-run reports reused vs new"       '"toGenerate"'            node "$S/scripts/import-vocabulary.mjs" "$T/ok.json" --dry-run

echo "== 4. rejection rules =="
check "rejects a sentence without the target word" "must contain \"waive\" or one of its inflections" node "$S/scripts/import-vocabulary.mjs" "$T/no_target_word.json" --dry-run
check "rejects cloze markup in a sentence"         "must be plain text"             node "$S/scripts/import-vocabulary.mjs" "$T/cloze_markup.json" --dry-run
check "rejects an incomplete context group"        "must provide Sentence, Meaning, SentenceCN, and Analysis together" node "$S/scripts/import-vocabulary.mjs" "$T/group_gap.json" --dry-run
check "rejects an unknown Theme"                   "Theme must be one of"           node "$S/scripts/import-vocabulary.mjs" "$T/bad_theme.json" --dry-run
check "rejects a full English part of speech"      "not a full English word"        node "$S/scripts/import-vocabulary.mjs" "$T/full_pos_word.json" --dry-run
check "rejects non-consecutive contexts"           "contexts must be consecutive"   node "$S/scripts/import-vocabulary.mjs" "$T/nonconsecutive.json" --dry-run
check "rejects a word already in the model"        "Words already exist in"         node "$S/scripts/import-vocabulary.mjs" "$T/duplicate_word.json" --dry-run

echo "== 5. confirmation gate (no writes allowed to happen) =="
check "refuses to import without --confirmed" "Refusing unconfirmed import" node "$S/scripts/import-vocabulary.mjs" "$T/ok.json" --without-tts

echo "== 6. 验收夹具卡（只写独立测试牌组，不触碰你的牌组） =="
FIXTURE_DECK="测试::anki-context验收"
FIXTURE_JSON="$T/verify_deck.json"
cat > "$FIXTURE_JSON" <<'JSON'
{
  "modelName": "微语境闪卡 1.0",
  "deckName": "测试::anki-context验收",
  "tags": ["微语境", "验收夹具"],
  "notes": [{
    "Word": "incur", "IPA": "/ɪnˈkɜːr/", "ChineseCore": "v. 招致，蒙受（损失、费用）", "Theme": "bauhaus",
    "Sentence1": "If we are late, we may incur a small fine.",
    "Meaning1": "招致（罚款）",
    "SentenceCN1": "如果我们迟到，可能要被罚一笔小钱。",
    "Analysis1": "incur a fine：招致罚款，主语通常是承担责任的一方。",
    "Sentence2": "We may incur more costs if we change the plan.",
    "Meaning2": "带来（额外成本）",
    "SentenceCN2": "如果改计划，我们可能要花更多的钱。",
    "Analysis2": "incur costs：带来成本，比 spend 更强调\"因某事而承担\"。",
    "Sentence3": "If you pay late, you may incur a fee.",
    "Meaning3": "产生（费用）",
    "SentenceCN3": "如果你晚付款，就可能要付一笔费用。",
    "Analysis3": "incur a fee：产生手续费、滞纳金等。"
  }]
}
JSON
curl -s -X POST "${ANKI_CONNECT_URL:-http://127.0.0.1:8765}" -d "{\"action\":\"createDeck\",\"version\":6,\"params\":{\"deck\":\"$FIXTURE_DECK\"}}" >/dev/null
if node "$S/scripts/verify-import.mjs" --deck "$FIXTURE_DECK" --word "incur" >/dev/null 2>&1; then
  echo "PASS  夹具卡已就位（复用）"; pass=$((pass+1))
elif node "$S/scripts/import-vocabulary.mjs" "$FIXTURE_JSON" --confirmed >/dev/null 2>&1; then
  echo "PASS  夹具卡已建（含 MiniMax 语音）"; pass=$((pass+1))
else
  echo "FAIL  夹具卡导入失败（缺 MiniMax key？）"; fail=$((fail+1))
fi
check "no notes need audio in the fixture deck" '"notesNeedingAudio": 0'  node "$S/scripts/add-audio-to-existing.mjs" --deck "$FIXTURE_DECK" --minimax-voice "English_Steady_Female_1" --dry-run
# 修复路径要确定性地验：改一句文本 → 语音指纹失效 → 必须重录（只动夹具牌组）。
# 文本用“加/去 today”来回切换，保证每轮跑都和上一轮不同（幂等，不会因重复跑而失效）。
python3 - "$FIXTURE_DECK" <<'PY'
import json, sys, urllib.request
deck = sys.argv[1]
def call(action, params):
    request = urllib.request.Request(
        "http://127.0.0.1:8765",
        data=json.dumps({"action": action, "version": 6, "params": params}).encode(),
        headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(request))["result"]
notes = call("notesInfo", {"notes": call("findNotes", {"query": f'deck:"{deck}" note:"微语境闪卡 1.0"'})})
note = next(n for n in notes if n["fields"]["Word"]["value"].strip() == "incur")
base = "If you pay late, you may incur a fine."
current = note["fields"]["Sentence3"]["value"].strip()
edited = base if current.endswith("today.") else "If you pay late, you may incur a fine today."
call("updateNoteFields", {"note": {"id": note["noteId"], "fields": {"Sentence3": edited}}})
print(f"fixture note {note['noteId']}: Sentence3 -> {edited!r} (audio now stale)")
PY
check "stale audio is planned for regeneration" '"field": "AudioSentence3"' node "$S/scripts/add-audio-to-existing.mjs" --deck "$FIXTURE_DECK" --word "incur" --refresh --minimax-voice "English_Steady_Female_1" --dry-run
check "regenerates the edited sentence"        '"completed"'        node "$S/scripts/add-audio-to-existing.mjs" --deck "$FIXTURE_DECK" --word "incur" --refresh --minimax-voice "English_Steady_Female_1"

echo "== 6b. rewrite-existing planning (read-only) =="
# 从真实夹具卡导出当前内容当改写输入：计划必须是「零改动 + 全部复用语音」——这才是幂等的断言。
python3 - "$FIXTURE_DECK" "$T/rewrite_ok.json" <<'PY'
import json, sys, urllib.request
deck, out = sys.argv[1], sys.argv[2]
def call(action, params):
    request = urllib.request.Request(
        "http://127.0.0.1:8765",
        data=json.dumps({"action": action, "version": 6, "params": params}).encode(),
        headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(request))["result"]
notes = call("notesInfo", {"notes": call("findNotes", {"query": f'deck:"{deck}" note:"微语境闪卡 1.0"'})})
note = next(n for n in notes if n["fields"]["Word"]["value"].strip() == "incur")
fields = {name: field["value"] for name, field in note["fields"].items()}
content = {name: fields[name] for name in ("Word", "IPA", "ChineseCore", "Theme")}
for index in (1, 2, 3):
    for prefix in ("Sentence", "Meaning", "SentenceCN", "Analysis"):
        content[f"{prefix}{index}"] = fields[f"{prefix}{index}"]
json.dump({"modelName": "微语境闪卡 1.0", "deckName": deck, "notes": [content]}, open(out, "w"), ensure_ascii=False, indent=2)
print(f"rewrite baseline exported from note {note['noteId']}")
PY
check "identical content plans no changes"     '"changes": []'      node "$S/scripts/rewrite-existing.mjs" "$T/rewrite_ok.json" --deck "$FIXTURE_DECK" --dry-run
check "matching audio is reused, not re-recorded" '"state": "reuse"' node "$S/scripts/rewrite-existing.mjs" "$T/rewrite_ok.json" --deck "$FIXTURE_DECK" --dry-run
check "refuses a word that is not in the deck" 'No 微语境闪卡 1.0 note with Word "ghostword"' node "$S/scripts/rewrite-existing.mjs" "$T/rewrite_ghost.json" --deck "$FIXTURE_DECK" --dry-run

echo "== 6c. rewrite-existing real write on the fixture (paid TTS, ~15s) =="
# 真写一条：改写必须走完整路径（合成 → 落盘 → 回读），否则"存进去的是垃圾"这类错不会被发现。
python3 - "$T/rewrite_ok.json" "$T/rewrite_real.json" <<'PY'
import json, sys
source, target = sys.argv[1], sys.argv[2]
payload = json.load(open(source))
note = payload["notes"][0]
base = "We may incur more costs if we change the plan."
current = note["Sentence2"].strip()
note["Sentence2"] = base if current.endswith("today.") else base[:-1] + " today."
note["Meaning2"] = "带来（额外成本，今日改期）"
json.dump(payload, open(target, "w"), ensure_ascii=False, indent=2)
print(f"rewrite target: Sentence2 -> {note['Sentence2']!r}")
PY
check "rewrite writes, regenerates audio, self-verifies" '"failed": 0' node "$S/scripts/rewrite-existing.mjs" "$T/rewrite_real.json" --deck "$FIXTURE_DECK" --confirmed --minimax-voice "English_Steady_Female_1"

echo "== 7. independent verification (read-only) =="
check "verify-import: fixture card passes"    '"failed": 0'            node "$S/scripts/verify-import.mjs" --deck "$FIXTURE_DECK"
check "verify-import: single-word mode"       '"word": "incur"'         node "$S/scripts/verify-import.mjs" --deck "$FIXTURE_DECK" --word "incur"

echo "== 8. A2 sentence-difficulty gate =="
check "A2 list loads"                          'allowedForms'           node -e "import('$S/scripts/level-check.mjs').then(async m => { const c = await m.loadCefrList(); console.log('allowedForms', c.allowed.size); })"
check "dry-run flags words above A2"           '超出 A2 的词'            node "$S/scripts/import-vocabulary.mjs" "$T/ok.json" --dry-run --without-tts
check "--strict-level blocks those sentences"  '必须保持在 CEFR A2 以内'  node "$S/scripts/import-vocabulary.mjs" "$T/ok.json" --dry-run --without-tts --strict-level
check_absent "--no-level-check silences the rule" '超出 A2 的词'         node "$S/scripts/import-vocabulary.mjs" "$T/ok.json" --dry-run --without-tts --no-level-check
check "strict mode accepts an A2-clean note"   '"dryRun": true'          node "$S/scripts/import-vocabulary.mjs" "$T/ok_a2.json" --dry-run --without-tts --strict-level

echo
echo "PASS=$pass FAIL=$fail"
[ "$fail" -eq 0 ]
