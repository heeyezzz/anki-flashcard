# anki-flashcard · 微语境闪卡制卡技能

把生词变成 Anki 里一张张**带语音、带中文解释、且除目标词以外你全都看得懂**的卡片——同时不弄乱已有的卡片和复习进度。

这是 [Hermes Agent](https://github.com/NousResearch/hermes-agent) 的一个 **skill**（技能包）：由一份流程手册 + 一组脚本 + 词表资源 + 37 项验收测试组成。它服务于 Anki 笔记类型 `微语境闪卡 1.0`，通过 [AnkiConnect](https://ankiweb.net/shared/info/2055492159) 读写。

## 这个技能解决什么问题

1. **"微语境"设计**：一个词配 3–5 句**不同生活场景**的例句，而不是一堆同义改写。正面只显示「单词 + 音标 + 一句例句（目标词高亮）」，答案（本句语境义、中文翻译、搭配解析）留在背面。
2. **A2 难度门（硬规则）**：例句里**除目标词以外**的词必须落在 CEFR A2 以内。否则你答不出来时，分不清是"没记住这个词"还是"整句没读懂"。脚本拿着 7035 条的 CEFR 词表逐词校验，把超纲词连等级一起报出来（`penalty (B2)`），并支持你自己的白名单。
3. **真人质感语音**：每个词 1 段、每句 1 段 MP3（MiniMax TTS）。文件名由内容哈希决定，即"内容寻址"——改哪句就只重录哪句，没改的复用，不花冤枉钱。
4. **确认门**：`--dry-run` 先给你看草稿（词、音标、每句 + 中文 + 搭配解析 + 超纲词清单），你点头后 `--confirmed` 才真写库、才请求语音。
5. **独立验收**：写入后由另一个脚本回查（字段对不对、语音文件真的存在且体量正常、是否恰好一张卡、有没有把答案漏到正面）。

## 安装

```sh
git clone https://github.com/heeyezzz/anki-flashcard.git \
  ~/.hermes/skills/education/anki-flashcard
```

（任何 Hermes skill 目录都可以；`SKILL.md` 所在目录即技能根目录。）

## 依赖

| 依赖 | 说明 |
|---|---|
| Anki + Agent Connect | 运行中的 Anki；Agent Connect（AnkiConnect Plus，兼容原版 AnkiConnect）监听 `127.0.0.1:8766`；原版 AnkiConnect 在 `8765`，用 `ANKI_CONNECT_URL` 切换。`verify-import.mjs` 依赖 Plus 独有的 `renderCard` |
| Node.js ≥ 18 | 脚本无第三方依赖，只用标准库 |
| MiniMax API Key | 按顺序查找：环境变量 `MINIMAX_API_KEY` → macOS Keychain 项 `anki-minimax-tts` → 本地 `.env` |
| 笔记类型 `微语境闪卡 1.0` | 已存在于你的 Anki 中（本技能不修改模板/样式） |

Keychain 写法：

```sh
security add-generic-password -U -a "$USER" -s anki-minimax-tts -w "$MINIMAX_KEY"
```

## 用法

```sh
SKILL_DIR=~/.hermes/skills/education/anki-flashcard

# 1) 建新卡：先看草稿，确认后再落库
node "$SKILL_DIR/scripts/import-vocabulary.mjs" /abs/path/notes.json --dry-run
node "$SKILL_DIR/scripts/import-vocabulary.mjs" /abs/path/notes.json --confirmed \
  --minimax-voice "English_Steady_Female_1"

# 2) 重做已有卡（改例句、换难度规则；内容 + 语音一起换，保留复习排程）
node "$SKILL_DIR/scripts/rewrite-existing.mjs" /abs/path/rewrite.json --deck "all in one::微语境闪卡" --dry-run
node "$SKILL_DIR/scripts/rewrite-existing.mjs" /abs/path/rewrite.json --deck "all in one::微语境闪卡" --confirmed

# 3) 给已有卡片补/重录语音
node "$SKILL_DIR/scripts/add-audio-to-existing.mjs" --deck "all in one::微语境闪卡" --refresh --dry-run

# 4) 独立验收（只读）
node "$SKILL_DIR/scripts/verify-import.mjs" --deck "all in one::微语境闪卡"

# 5) 验收套件（37 项，只写自己的夹具牌组）
bash "$SKILL_DIR/tests/acceptance.sh"
```

输入 JSON 的字段与规则见 [`references/note-schema.md`](references/note-schema.md)；例句设计标准（含 A2 规则）见 [`references/example-design.md`](references/example-design.md)。

## 目录结构

```
SKILL.md                      流程手册：字段契约、确认门、坑位
references/
  note-schema.md              字段契约（必填 / 可选 / 音频字段）
  example-design.md           3–5 个微语境的设计标准 + A2 难度规则 + 自查清单
  minimax-tts.md              语音配置、命名与复用规则
scripts/
  import-vocabulary.mjs       建新卡（--dry-run / --confirmed）
  rewrite-existing.mjs        重做已有卡（内容 + 语音，保留排程）
  add-audio-to-existing.mjs   补/重录语音（--refresh）
  verify-import.mjs           独立验收（字段 / 媒体 / 单卡 / 无答案泄漏 / A2 审计）
  note-rules.mjs              内容规则单一来源（导入与改写共用同一套校验）
  level-check.mjs             A2 难度校验（CEFR 词表 + 屈折展开 + 白名单）
  ensure-audio-fields.mjs     音频字段只读体检
  minimax-tts.mjs             语音请求与确定性文件名
  minimax-credentials.mjs     key 解析：env → Keychain → .env
assets/
  cefr-j-words.tsv            CEFR 词表 7035 条（难度门依据，来源见下）
  allow-extra.txt             自备白名单：你已掌握的专业词，不触发 A2 警告
  irregular-forms.txt         不规则变化（made / found / meant…）不算超纲
tests/acceptance.sh           验收套件（37 项）
```

## 设计要点（为什么这样做）

- **内容寻址音频**：`<prefix>-<slug>-<slot>-<sha256(text,model,voice,speed)[:16]>.mp3`。改句子 = 换文件名 = 自动重录；没改 = 复用。中断后重跑不会重复付费。
- **规则单一来源**：`note-rules.mjs` 同时被"建卡"和"改卡"使用，避免两条路径的标准跑偏。
- **改写而非重建**：`rewrite-existing.mjs` 按 `Word` 在指定牌组内定位笔记，只更新内容与语音，**不删卡不重建**，学习进度（queue / reps / lapses）完整保留；写前落一份字段快照到 `~/.hermes/cache/anki-flashcard/backups/`，删媒体前会确认全模型没有别的卡在引用它。
- **只读体检**：`ensure-audio-fields.mjs`、`verify-import.mjs` 永不写库；需要修复的动作要显式 `--apply` / `--confirmed`。
- **不碰模板与排程**：本技能只写笔记字段与媒体文件，不改笔记类型模板/样式，不评分、不改调度。

## 数据来源与许可

- **代码**：MIT（见 [LICENSE](LICENSE)）。
- **`assets/cefr-j-words.tsv`**：数据来自 [Maximax67/Words-CEFR-Dataset](https://github.com/Maximax67/Words-CEFR-Dataset)（整合 CEFR-J Wordlist 与 Octanove Vocabulary Profile，后者以 **CC-BY-SA 4.0** 发布）。该数据文件按 **CC-BY-SA 4.0** 使用，仅用于例句难度校验；如需商用或再分发，请自行核对上游许可或替换为你自己的词表（`scripts/level-check.mjs` 只要求同格式的 `<词形>\t<等级>` TSV）。

## 发布更新（维护本仓库）

这个目录同时是你的 Hermes skill 和这个 Git 仓库。改完 skill 后：

```sh
cd ~/.hermes/skills/education/anki-flashcard
git add -A && git commit -m "描述这次改动"
GH_CONFIG_DIR=~/.hermes/gh-config git push
```

> 那台机器上 `~/.config` 的属主是 root，`gh` 建不了自己的配置目录，所以用 `GH_CONFIG_DIR` 指到可写位置。
> 想一劳永逸：`sudo chown -R $(whoami) ~/.config`，之后直接 `git push` 即可。

## 相关技能

- [`anki-card-template-design`](https://github.com/heeyezzz/anki-card-template-design)：卡片模板 / CSS 的安全改法与离线渲染验证。
