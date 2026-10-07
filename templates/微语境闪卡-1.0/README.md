# 当前集合里的模板（留痕与回滚）

这三份文件是 `微语境闪卡 1.0` 笔记类型在 Anki 集合中的**当前** Front / Back / CSS 副本，
与集合逐字节一致（`scripts/template-push.mjs --check` 可以核对）。
改动历史在仓库根的 `CHANGELOG.md`，本文件只描述**现在的样子**。

## 正面（检索面）

`Word` + 单词喇叭 + `IPA` 在带红顶条的边框面板里，下面「例句」面板一次显示**全部** `Sentence{i}`：
目标词由 `mctxPattern()` 在渲染时高亮，每行右上角一颗喇叭。没有中文、没有轮换、没有
localStorage 状态——任何答案字段都不进正面 DOM（`scripts/verify-import.mjs` 会查渲染后的题面）。

## 背面（答案面）

1. 与正面同一块词头面板，下面多一行 **`ChineseCore` 释义块**：脚本 `splitGroups()` 把那一整行
   词典串按「；」和词性组之间的「 / 」**分组**（括号内标点不切），词性一变即新起一组，渲染成
   左侧方框词性徽标（只在组首出现、去掉句点）+ 右列义项 ①②③（跨词性连续编号）。
2. **例句面板**：每行英文句（目标词红色粗体，无底色）+ 中文译文（`【…】` 渲染成正文色的
   1px 点状下划线，点击就地展开该组 `Meaning{i}`），喇叭绝对定位在行的右上角，句子让出右侧 30px。
   **没有 01/02 编号。**
3. **助记面板**：各句 `Analysis{i}` 按例句顺序作为纯文本行归集到这里（模板里它们是隐藏源
   `.mctx-analysis-src`，脚本读出来再填），后面跟 `OtherMeanings` 的「其他义项」折叠块；
   两者都空时整块 `hidden`。
4. 自动播放**只有单词**，例句一律手动点。同一时刻只允许一个声音：点击前 `stopAll(keep)` 停其余，
   `play` 回调里再兜一道（不是 `sounding` 就 `pause`），因为 Android WebView 上 `pause()` 可能抢在
   `play()` 的承诺落地之前。

## 改模板的流程（脚本已就位，别手搓）

```sh
node scripts/anki-session.mjs --start                       # Anki 上线并同步
node scripts/template-push.mjs --snapshot                    # 回滚点落盘
# 编辑 Front.html / Back.html / style.css
node scripts/render-card.mjs --word schedule --side both      # 用集合里的真字段离线渲染 + 截图
node tests/template-invariants.mjs                             # 共用函数一致 / 无死 CSS / 音频独占
node scripts/template-push.mjs --push                          # 基线守卫 + 整表回传 + 逐字节读回
node scripts/verify-import.mjs --deck 'all in one::微语境闪卡'
node scripts/anki-session.mjs --finish                         # 同步并关闭
```

三条硬约束：

- **渲染层改动不得触发笔记重写或重新付费 TTS**（字段值一个都不动）。
- `render-card.mjs` 从**集合现拉字段**，不要用旧的 `~/.hermes/cache/.../backups/*.json`——
  那份快照缺 `【】` 标记，会让译文下划线整条静默失去验证。
- 真实审阅端是 **AnkiDroid**：没有 `title` 提示、`:hover` 点按后会黏住。布局结论最终要在手机截图上确认。

`SentenceCN{i}` 里的 `【…】` 是这套渲染的契约，由 `scripts/note-rules.mjs` 校验（缺失出警告）。
正背面共用的函数（`mctxPattern` / `bindPlaying` / `text`）是**复制**而非共享——Anki 模板没有 import
机制，所以 `tests/template-invariants.mjs` 要求它们逐字节一致，改一处必须同步两处。
