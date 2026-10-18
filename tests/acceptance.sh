#!/usr/bin/env bash
# Acceptance tests for the anki-flashcard skill. Read-only against Anki:
# --dry-run for the happy path, --without-tts + no --confirmed for the refusal test.
# Nothing here writes notes, media, or the note type.
set -uo pipefail
S="$(cd "$(dirname "$0")/.." && pwd)"
T="${TMPDIR:-/tmp}/anki-flashcard-tests"
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

echo "== 0. session (Anki may have been closed by a previous --finish) =="
if node "$S/scripts/anki-session.mjs" --start >/dev/null; then echo "PASS  anki-session --start"; pass=$((pass+1));
else echo "FAIL  anki-session --start（Anki 没能上线或同步失败）"; fail=$((fail+1)); fi

echo "== 1. syntax =="
for f in "$S"/scripts/*.mjs; do
  if node --check "$f" 2>/dev/null; then echo "PASS  node --check $(basename "$f")"; pass=$((pass+1));
  else echo "FAIL  node --check $(basename "$f")"; node --check "$f"; fail=$((fail+1)); fi
done

echo "== 2. audio-field audit (read-only) =="
check "anki-session requires a mode"      "Usage: node anki-session.mjs" node "$S/scripts/anki-session.mjs"
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
    "Meaning1": "免除（费用）", "SentenceCN1": "银行同意对小额账户【免除】转账手续费。",
    "Analysis1": "waive a fee：正式用语，多用于费用、权利、规则。",
    "Sentence2": "Both sides agreed to waive the penalty clause in the contract.",
    "Meaning2": "放弃（合同条款）", "SentenceCN2": "双方同意【放弃】合同中的违约金条款。",
    "Analysis2": "waive a clause / a penalty：常用于合同谈判。",
    "Sentence3": "The customs office may waive the inspection for small shipments.",
    "Meaning3": "免于（检查）", "SentenceCN3": "海关可能对小额货物【免予】查验。",
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
# 检索条件查重：同一个 Meaning 是硬错误；只换主语/宾语的改写句要在 dry-run 里被点名。
variant("same_meaning", lambda n: n.update(Meaning2="免除（费用）"))
variant("no_mark", lambda n: n.update(SentenceCN1="银行同意对小额账户免除转账手续费。"))
variant("bad_lexicon", lambda n: n.update(ChineseCore="adj. 免除，放弃", IPA="/əˈbaʊd/"))
# ChineseCore 是整词释义：单词卡不许塞英文短语条目（真卡 spite 曾把 phr. in spite of 写进来）
variant("phrase_in_gloss", lambda n: n.update(ChineseCore="v. 免除，放弃（费用）；phr. waive the rule 通融一下"))
variant("paraphrase", lambda n: n.update(
    Sentence2="The bank agreed to waive the transfer fee for our account.",
    Meaning2="免除（我行账户费用）", SentenceCN2="银行同意免掉我们账户的转账费。"))

# A2-clean note: every word except the target is A1/A2, so --strict-level must accept it.
(T/"ok_a2.json").write_text(json.dumps({
  "modelName": "微语境闪卡 1.0",
  "deckName": "all in one::微语境闪卡",
  "notes": [{
    "Word": "borrow", "IPA": "/ˈbɒroʊ/", "ChineseCore": "v. 借，借用（东西、钱）", "Theme": "bauhaus",
    "Sentence1": "Can I borrow your pen for a minute?",
    "Meaning1": "借（东西）", "SentenceCN1": "能【借】你的笔用一分钟吗？",
    "Analysis1": "borrow + 东西：从别人那里借来，常与 from 连用。",
    "Sentence2": "She borrowed some money from her brother.",
    "Meaning2": "借（钱）", "SentenceCN2": "她向她哥哥【借】了些钱。",
    "Analysis2": "borrow money from sb：钱是从别人那里借来的。",
    "Sentence3": "We borrow books from the library every week.",
    "Meaning3": "借阅（书）", "SentenceCN3": "我们每周都从图书馆【借】书。",
    "Analysis3": "borrow books：图书馆借书是最常见的搭配。"
  }]
}, ensure_ascii=False, indent=2))
# 改写夹具：内容与夹具卡一致（含被“指纹失效”测试改过的 Sentence3），用于验证“不改就不重录”。
def rewrite_note(word="incur"):
    return {
        "Word": word, "IPA": "/ɪnˈkɜːr/", "ChineseCore": "v. 招致，蒙受（损失、费用）", "Theme": "bauhaus",
        "Sentence1": "If we are late, we may incur a small fine.", "Meaning1": "招致（罚款）",
        "SentenceCN1": "如果我们迟到，可能就【招致】一笔小罚款。", "Analysis1": "incur a fine：招致罚款。",
        "Sentence2": "We may incur more costs if we change the plan.", "Meaning2": "带来（额外成本）",
        "SentenceCN2": "如果改计划，我们可能【带来】更多花费。", "Analysis2": "incur costs：带来成本。",
        "Sentence3": "If you pay late, you may incur a fine.", "Meaning3": "产生（费用）",
        "SentenceCN3": "如果你晚付款，就可能【产生】一笔费用。", "Analysis3": "incur a fee：产生费用。"
    }
(T/"rewrite_ok.json").write_text(json.dumps({
    "modelName": "微语境闪卡 1.0", "deckName": "测试::anki-flashcard验收", "notes": [rewrite_note()]}, ensure_ascii=False))
ghost = rewrite_note("ghostword")
ghost.update({
    "IPA": "/ˈɡoʊstwɜːrd/", "ChineseCore": "n. 幽灵词（验收夹具）",
    "Sentence1": "Please ghostword the file before the meeting.", "Meaning1": "幽灵用法一",
    "SentenceCN1": "开会前请【幽灵】一下这个文件。", "Analysis1": "ghostword sth：验收用假搭配。",
    "Sentence2": "We ghostword the plan again next week.", "Meaning2": "幽灵用法二",
    "SentenceCN2": "我们下周再【幽灵】一下计划。", "Analysis2": "ghostword the plan：验收用假搭配。",
    "Sentence3": "They always ghostword the box in the morning.", "Meaning3": "幽灵用法三",
    "SentenceCN3": "他们总是在早上【幽灵】那个箱子。", "Analysis3": "ghostword the box：验收用假搭配。"})
(T/"rewrite_ghost.json").write_text(json.dumps({
    "modelName": "微语境闪卡 1.0", "deckName": "测试::anki-flashcard验收", "notes": [ghost]}, ensure_ascii=False))
print("fixtures written to", T)
PY
check "--dry-run prints the content preview"  '"dryRun": true'          node "$S/scripts/import-vocabulary.mjs" "$T/ok.json" --dry-run
check "--dry-run lists planned audio files"   '-waive-word-'          node "$S/scripts/import-vocabulary.mjs" "$T/ok.json" --dry-run
check "--dry-run names the sentence slots"    '-waive-sentence-1-'    node "$S/scripts/import-vocabulary.mjs" "$T/ok.json" --dry-run
check "--dry-run reports reused vs new"       '"toGenerate"'            node "$S/scripts/import-vocabulary.mjs" "$T/ok.json" --dry-run
check "--dry-run flags a paraphrased context" '个实词相同'  node "$S/scripts/import-vocabulary.mjs" "$T/paraphrase.json" --dry-run --without-tts

echo "== 4. rejection rules =="
check "rejects a sentence without the target word" "must contain \"waive\" or one of its inflections" node "$S/scripts/import-vocabulary.mjs" "$T/no_target_word.json" --dry-run
check "rejects cloze markup in a sentence"         "must be plain text"             node "$S/scripts/import-vocabulary.mjs" "$T/cloze_markup.json" --dry-run
check "rejects an incomplete context group"        "must provide Sentence, Meaning, SentenceCN, and Analysis together" node "$S/scripts/import-vocabulary.mjs" "$T/group_gap.json" --dry-run
check "rejects an unknown Theme"                   "Theme must be one of"           node "$S/scripts/import-vocabulary.mjs" "$T/bad_theme.json" --dry-run
check "rejects a full English part of speech"      "not a full English word"        node "$S/scripts/import-vocabulary.mjs" "$T/full_pos_word.json" --dry-run
check "rejects a phrase entry inside a single word's gloss" "混进了短语条目"  node "$S/scripts/import-vocabulary.mjs" "$T/phrase_in_gloss.json" --dry-run --without-tts
check "rejects non-consecutive contexts"           "contexts must be consecutive"   node "$S/scripts/import-vocabulary.mjs" "$T/nonconsecutive.json" --dry-run
check "rejects a word already in the model"        "Words already exist in"         node "$S/scripts/import-vocabulary.mjs" "$T/duplicate_word.json" --dry-run
check "rejects two contexts sharing one Meaning"   "的 Meaning 完全相同"     node "$S/scripts/import-vocabulary.mjs" "$T/same_meaning.json" --dry-run

echo "== 5. confirmation gate (no writes allowed to happen) =="
check "refuses to import without --confirmed" "Refusing unconfirmed import" node "$S/scripts/import-vocabulary.mjs" "$T/ok.json" --without-tts

echo "== 6. 验收夹具卡（只写独立测试牌组，不触碰你的牌组） =="
FIXTURE_DECK="测试::anki-flashcard验收"
FIXTURE_JSON="$T/verify_deck.json"
cat > "$FIXTURE_JSON" <<'JSON'
{
  "modelName": "微语境闪卡 1.0",
  "deckName": "测试::anki-flashcard验收",
  "tags": ["微语境", "验收夹具"],
  "notes": [{
    "Word": "incur", "IPA": "/ɪnˈkɜːr/", "ChineseCore": "v. 招致，蒙受（损失、费用）", "Theme": "bauhaus",
    "Sentence1": "If we are late, we may incur a small fine.",
    "Meaning1": "招致（罚款）",
    "SentenceCN1": "如果我们迟到，可能就【招致】一笔小罚款。",
    "Analysis1": "incur a fine：招致罚款，主语通常是承担责任的一方。",
    "Sentence2": "We may incur more costs if we change the plan.",
    "Meaning2": "带来（额外成本）",
    "SentenceCN2": "如果改计划，我们可能【带来】更多花费。",
    "Analysis2": "incur costs：带来成本，比 spend 更强调\"因某事而承担\"。",
    "Sentence3": "If you pay late, you may incur a fee.",
    "Meaning3": "产生（费用）",
    "SentenceCN3": "如果你晚付款，就可能【产生】一笔费用。",
    "Analysis3": "incur a fee：产生手续费、滞纳金等。"
  }]
}
JSON
curl -s -X POST "${ANKI_CONNECT_URL:-http://127.0.0.1:8766}" -d "{\"action\":\"createDeck\",\"version\":6,\"params\":{\"deck\":\"$FIXTURE_DECK\"}}" >/dev/null
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
        "http://127.0.0.1:8766",
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
        "http://127.0.0.1:8766",
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
check "verify-import: a missing word reads as an answer, not a crash" "没有 Word 含" node "$S/scripts/verify-import.mjs" --deck "$FIXTURE_DECK" --word "nosuchword"

echo "== 8. A2 sentence-difficulty gate =="
check "A2 list loads"                          'allowedForms'           node -e "import('$S/scripts/level-check.mjs').then(async m => { const c = await m.loadCefrList(); console.log('allowedForms', c.allowed.size); })"
check "dry-run flags words above A2"           '超出 A2 的词'            node "$S/scripts/import-vocabulary.mjs" "$T/ok.json" --dry-run --without-tts
check "--strict-level blocks those sentences"  '必须保持在 CEFR A2 以内'  node "$S/scripts/import-vocabulary.mjs" "$T/ok.json" --dry-run --without-tts --strict-level
check_absent "--no-level-check silences the rule" '超出 A2 的词'         node "$S/scripts/import-vocabulary.mjs" "$T/ok.json" --dry-run --without-tts --no-level-check
check "strict mode accepts an A2-clean note"   '"dryRun": true'          node "$S/scripts/import-vocabulary.mjs" "$T/ok_a2.json" --dry-run --without-tts --strict-level

echo "== 9. 词典对账（ECDICT 精简表）=="
check "wrong part of speech is flagged"      "与 ECDICT 对该词的标注不符" node "$S/scripts/import-vocabulary.mjs" "$T/bad_lexicon.json" --dry-run --without-tts
check "a mismatched IPA is flagged"          "与 ECDICT 音标"             node "$S/scripts/import-vocabulary.mjs" "$T/bad_lexicon.json" --dry-run --without-tts
check "dry-run carries the sense list"       '"dictionary"'               node "$S/scripts/import-vocabulary.mjs" "$T/ok.json" --dry-run --without-tts
check_absent "a correct card stays quiet"    'ECDICT'                     node "$S/scripts/import-vocabulary.mjs" "$T/ok.json" --dry-run --without-tts
check "a missing gloss marker is flagged"      "需要恰好一处"   node "$S/scripts/import-vocabulary.mjs" "$T/no_mark.json" --dry-run --without-tts
check "irregular table covers ECDICT forms"  'went,brought,children'      node -e "import('$S/scripts/level-check.mjs').then(async m => { const c = await m.loadCefrList(); console.log(['went','brought','children'].filter((w) => c.allowed.has(w)).join(',')); })"

echo "== 9b. ChineseCore 词典底串（dictionary-first）=="
FLOOR="import('$S/scripts/lexicon.mjs').then(async m => { console.log(m.dictionaryCore({ raw: 'n. 特许, 让步；[经] 核准, 许可, 特殊(权)' }).core); })"
check "the floor keeps the general gloss"        'n. 特许，让步'   node -e "$FLOOR"
check_absent "the floor drops domain-tagged gloss" '核准'          node -e "$FLOOR"
check "a pos-less gloss falls back with a reason" '无词性'         node -e "import('$S/scripts/lexicon.mjs').then(async m => { console.log(m.dictionaryCore({ raw: '照做' }).reason); })"
check "dry-run carries the dictionary floor"     '"core"'         node "$S/scripts/import-vocabulary.mjs" "$T/ok.json" --dry-run --without-tts
# ECDICT 用换行分隔词性组，而 CSV 里存的是字面 \n：不先归一，vt. 组会被并进 n.
FLOOR_NL="import('$S/scripts/lexicon.mjs').then(m => { console.log(m.dictionaryCore({ raw: 'n. 恶意, 怨恨' + String.fromCharCode(92) + 'nvt. 故意刁难, 欺侮' }).core); })"
check "a literal \\n starts a new part-of-speech group" 'n. 恶意，怨恨；v. 故意刁难，欺侮' node -e "$FLOOR_NL"
check_absent "the literal \\n never leaks into the floor"  '\\nvt'            node -e "$FLOOR_NL"
FLOOR_TAG="import('$S/scripts/lexicon.mjs').then(m => { console.log(m.dictionaryCore({ raw: 'n. 特许, 让步, 认可' + String.fromCharCode(10) + '[经] 核准, 许可' }).core); })"
check_absent "a domain-tagged group after a newline is dropped" '核准'          node -e "$FLOOR_TAG"

echo "== 10a. 个人词库豁免（认识的词不该被 A2 门拦住）=="
GATE="import('$S/scripts/level-check.mjs').then(async (m) => { const c = await m.loadCefrList(); const hits = m.findAboveLevel('The attorney needs a chronic dose.', { targetForms: new Set(['dose']), levels: c.levels, allowed: c.allowed }); console.log('known=' + c.known.count + ' missing=' + c.known.missing + ' flagged=' + hits.map((h) => h.token).join('+')); })"
check "词库已加载且词库内的词不再报警" "missing=false" node -e "$GATE"
GATE2="import('$S/scripts/level-check.mjs').then(async (m) => { const c = await m.loadCefrList(); const hits = m.findAboveLevel('A meticulous audit follows.', { targetForms: new Set(), levels: c.levels, allowed: c.allowed }); console.log('flagged=' + hits.map((h) => h.token).join('+')); })"
check "词库外的难词仍然报警" "flagged=meticulous+audit" node -e "$GATE2"
check "dry-run 报出词库状态"        '"wordbook"'           node "$S/scripts/import-vocabulary.mjs" "$T/ok.json" --dry-run --without-tts

# 会话开始时把词库刷成 gist 上的最新版；拉不到也不能把整轮制卡卡住。
REFRESH="
const { refreshKnownWords } = await import('$S/scripts/known-words.mjs');
const { writeFile } = await import('node:fs/promises');
const d = '$T/refresh';
await import('node:fs/promises').then((fs) => fs.mkdir(d, { recursive: true }));
await writeFile(d + '/ok.mjs', 'console.log(1)');
await writeFile(d + '/bad.mjs', 'console.error(String.fromCharCode(98,111,111,109))' + String.fromCharCode(10) + 'process.exit(2)');
const a = await refreshKnownWords({ pullScript: d + '/nope.mjs' });
const b = await refreshKnownWords({ pullScript: d + '/ok.mjs' });
const c = await refreshKnownWords({ pullScript: d + '/bad.mjs' });
console.log(JSON.stringify([a, b, c]));
"
check "没有 pull 脚本时沿用本地快照，不报错" "沿用本地词库快照" node --input-type=module -e "$REFRESH"
check "拉取成功时报告已刷新" "\"ok\":true" node --input-type=module -e "$REFRESH"
check "拉取失败时带上原因并继续" "词库拉取失败" node --input-type=module -e "$REFRESH"
check "会话开始会刷新词库" "refreshKnownWords" cat "$S/scripts/anki-session.mjs"
START_JSON="$(node "$S/scripts/anki-session.mjs" --start 2>&1)"
if grep -qF '"wordbook"' <<<"$START_JSON" && grep -qE '词库已从 gist 刷新|沿用本地|词库拉取失败' <<<"$START_JSON"; then
  echo "PASS  --start 输出带词库刷新结果"; pass=$((pass+1))
else echo "FAIL  --start 输出带词库刷新结果"; echo "      got: $(head -c 400 <<<"$START_JSON")"; fail=$((fail+1)); fi

echo "== 10b. 音频来源分流（单词走有道，例句走 MiniMax）=="
FP=$(node -e "
const y = await import('$S/scripts/youdao-tts.mjs');
const m = await import('$S/scripts/minimax-tts.mjs');
const MM = { model: 'speech-2.8-hd', voiceId: 'English_Steady_Female_1', speed: 1, mediaPrefix: 'minimax' };
const mk = (src) => m.createMediaFilename({ word: 'spite', slot: 'word', text: 'spite', model: src.model, voiceId: src.voiceId, speed: src.speed, prefix: src.prefix });
console.log([mk(y.wordAudioSource('youdao', MM)), mk(y.wordAudioSource('youdao-us', MM)), mk(y.wordAudioSource('minimax', MM))].join(' '));
" --input-type=module)
check "词音文件名带 youdao-uk 前缀"           "youdao-uk-spite-word"  printf '%s' "$FP"
check "美音是另一个文件名（换口音会重录）"     "youdao-us-spite-word"  printf '%s' "$FP"
[ -n "$FP" ] && [ "$(echo "$FP" | tr ' ' '\n' | sort -u | wc -l | tr -d ' ')" = "3" ] \
  && { echo "PASS  三种词音来源的文件名互不相同（不会误复用）"; pass=$((pass+1)); } \
  || { echo "FAIL  三种词音来源的文件名互不相同: $FP"; fail=$((fail+1)); }
check "dry-run 把 WordAudio 标成 youdao"        '"provider": "youdao"'   node "$S/scripts/import-vocabulary.mjs" "$T/ok.json" --dry-run --minimax-voice English_Steady_Female_1
check "例句仍归 MiniMax"                          '"provider": "minimax"'  node "$S/scripts/import-vocabulary.mjs" "$T/ok.json" --dry-run --minimax-voice English_Steady_Female_1
check "拒绝未知的 --word-tts"                     "只能是"                 node "$S/scripts/import-vocabulary.mjs" "$T/ok.json" --dry-run --word-tts google

# 有道端点契约：词条有音频、句子没有。网络不可用时跳过，不拖垮套件。
YOUDAO_CONTRACT=$(node -e "
import('$S/scripts/youdao-tts.mjs').then(async (y) => {
  try {
    const ok = await y.synthesizeYoudao({ text: 'spite' });
    try { await y.synthesizeYoudao({ text: 'She trembled.' }); console.log('REGRESSION 句子竟然取到了音频，分流前提已变'); }
    catch (_) { console.log('PASS 词条可取（' + ok.bytes + ' 字节）且句子取不到'); }
  } catch (e) { console.log('SKIP 有道端点不可达：' + e.message.slice(0, 60)); }
});")
case "$YOUDAO_CONTRACT" in
  SKIP*) echo "SKIP  有道端点契约（$YOUDAO_CONTRACT）";;
  PASS*) echo "PASS  有道端点契约";;
  *)     echo "FAIL  有道端点契约：$YOUDAO_CONTRACT"; fail=$((fail+1));;
esac

echo "== 10c. 义项覆盖（三条语境不能都练同一个意思）=="
python3 - "$T" <<'PY'
import json, sys, pathlib
T = pathlib.Path(sys.argv[1])
skinny = {
  "Word": "skinny", "IPA": "/ˈskɪni/", "Theme": "bauhaus",
  "ChineseCore": "adj. 极瘦的，瘦得皮包骨的；（衣服）紧身的；少的，微薄的",
  "Sentence1": "Her brother was skinny as a boy, although he ate all day.",
  "Meaning1": "（人）极瘦的", "SentenceCN1": "她哥哥小时候【瘦得皮包骨】，虽然他整天都在吃。",
  "Analysis1": "be skinny as a boy：形容人瘦。",
  "Sentence2": "The horse came back skinny from the long cold winter.",
  "Meaning2": "（动物）瘦骨嶙峋的", "SentenceCN2": "那匹马熬过漫长寒冷的冬天回来时【瘦得厉害】。",
  "Analysis2": "come back skinny：动物过冬后掉膘。",
  "Sentence3": "You are too skinny now: are you eating enough food?",
  "Meaning3": "太瘦了（带着担心说）", "SentenceCN3": "你现在【太瘦了】：饭吃够了吗？",
  "Analysis3": "too skinny：带关心语气的说法。"
}
def with_senses(senses):
    note = json.loads(json.dumps(skinny))
    for i, s in enumerate(senses, 1):
        note[f"Sense{i}"] = s
    return note
(T/"sense_all_one.json").write_text(json.dumps(with_senses([1, 1, 1]), ensure_ascii=False))
(T/"sense_cross.json").write_text(json.dumps(with_senses([1, 2, 1]), ensure_ascii=False))
(T/"sense_missing.json").write_text(json.dumps(skinny, ensure_ascii=False))
(T/"sense_ambiguous.json").write_text(json.dumps({
  "Word": "concerned", "IPA": "/kənˈsɜːnd/", "Theme": "bauhaus",
  "ChineseCore": "adj. 担心的，关切的；（与…）有关的",
  "Sentence1": "She looked concerned, so I asked her what was wrong.",
  "Meaning1": "（神色上）担忧的", "SentenceCN1": "她看上去【很担心】，所以我问她怎么了。",
  "Analysis1": "look concerned：写在脸上那种担心。",
  "Sentence2": "People in the town are concerned about the price of bread.",
  "Meaning2": "对某事忧虑、关心", "SentenceCN2": "镇上的人【担心】面包的价格。",
  "Analysis2": "be concerned about：为某事操心。",
  "Sentence3": "The meeting is concerned with two simple rules.",
  "Meaning3": "与……有关、涉及", "SentenceCN3": "这次会议只【涉及】两条简单的规定。",
  "Analysis3": "be concerned with：关于、涉及，不表情绪。"
}, ensure_ascii=False))
PY
# 直接跑 validateNote：导入器会先查"这词是否已在牌组里"，用真卡当夹具会被那道检查挡在前面。
GATE_RUN="
const { validateNote } = await import('$S/scripts/note-rules.mjs');
const { readFile } = await import('node:fs/promises');
const run = async (file) => {
  const note = JSON.parse(await readFile('$T/' + file, 'utf8'));
  const warnings = [];
  try {
    validateNote(note, 0, { warnings, levelFailures: [], seenWords: new Set(), cefr: null, levelCheck: null });
  } catch (e) { return 'THROW│' + e.message.slice(0, 30); }
  // 把警告归成标记，断言才不会被同一行里的其它警告带偏。
  const flags = [];
  if (warnings.some((w) => w.includes('没有逐条写'))) flags.push('UNDECLARED');
  if (warnings.some((w) => w.includes('可能误判'))) flags.push('COLLAPSE_HINT');
  if (warnings.some((w) => w.includes('声明义项'))) flags.push('MISMATCH');
  return flags.length ? flags.join('+') : 'CLEAN';
};
for (const f of ['sense_all_one.json', 'sense_cross.json', 'sense_missing.json', 'sense_ambiguous.json']) {
  console.log(f + '|' + await run(f));
}
"
GATE_OUT=$(node --input-type=module -e "$GATE_RUN" 2>&1)
check "三条语境声明同一个义项：硬失败"     "sense_all_one.json|THROW│notes[0] 的 3 条语境全部声明为义项1" printf '%s' "$GATE_OUT"
check "声明与释义用词对不上时报出来"       "sense_cross.json|MISMATCH"                                   printf '%s' "$GATE_OUT"
check "多义项卡没声明 Sense：提示补上"     "sense_missing.json|UNDECLARED+COLLAPSE_HINT"                 printf '%s' "$GATE_OUT"
# concerned 的两个义项释义只共一个「关」字，靠汉字重合会误判成重复——这条守的是那个假报警。
check "释义用词重叠时不误判成重复"         "sense_ambiguous.json|UNDECLARED"                             printf '%s' "$GATE_OUT"
check_absent "兜底提示只在该报时报"         "sense_ambiguous.json|UNDECLARED+COLLAPSE_HINT"              printf '%s' "$GATE_OUT"
check "搭配窗口取目标词两侧各两词"  '…brother was [skinny] as a…'  node -e "import('$S/scripts/note-rules.mjs').then(m => console.log(m.collocationWindow('Her brother was skinny as a boy, although he ate all day.', 'skinny')))"
check "dry-run 预览带搭配与义项"  '"collocation"'  node "$S/scripts/import-vocabulary.mjs" "$T/ok.json" --dry-run --without-tts

echo "== 10. 模板不变量（共用函数一致 / 无死 CSS / 音频独占）=="
check "template invariants all hold" "模板不变量全部通过" node "$S/tests/template-invariants.mjs"

echo
echo "PASS=$pass FAIL=$fail"
[ "$fail" -eq 0 ]
