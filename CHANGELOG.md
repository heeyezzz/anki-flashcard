# 变更记录

模板/渲染层的轮次史（"第 N 轮"）记在这里，当前形态写在
`templates/微语境闪卡-1.0/README.md`。改卡面时把新一轮追加到本文件顶部，不要往 README 里堆。
字段契约与内容规则的变更记在 `SKILL.md` 对应小节，不放这里。

## 2026-10-06

**第十四轮 · 修复 `phr.` / `det.` 义项被挂到上一个词性徽标下面。** 现象（真卡 `spite`）：
`n. 恶意，怨恨 / phr. in spite of 尽管，虽然 / in spite of oneself 不由自主地` 渲染成三条都顶着 `n` 徽标，
`phr.` 只是行内普通文字。根因是仓库里有两份词性表且不一致：`scripts/lexicon.mjs` 的 `POS_CANON`
会产出 `phr.`/`det.`，而 `Back.html` 的 `POS_HEAD` 白名单里没有它们，于是 `splitGroups()` 不为它们开新组。
修法：`lexicon.mjs` 导出 `CARD_POS`（17 项，唯一来源），模板抄一份并在注释里点名来源，
`tests/template-invariants.mjs` 新增一项断言两边集合相等（反向对照过：旧表会被报"缺 det、phr"）。
纯渲染层，笔记与音频未动。

**第十三轮 · 去掉例句与助记的编号，整卡再压一档。** 编号和它那层 `.mctx-other-heading`
一起从两个模板删掉（CSS 的 heading/index 规则与包豪斯红色序号规则同步删，`data-i` 已无人读取也删）。
喇叭因此改成绝对定位在行的右上角（`.mctx-other-item { position:relative; padding-right:30px }` +
`.mctx-audio-btn--other { position:absolute; top:8px; right:0 }`），句子让出右侧 30px，320px 下验证不压字。
助记行由脚本只生成一个 `<p class="mctx-analysis">`。译文 15px/1.75 → 13px/1.6。其余固定值继续收：
行 `padding 10/12→8/9、gap 5→4`、词头块 `margin-bottom 18→14、padding 14/18→12/16`、释义块
`padding 14/16→10/14`、面板 `clamp(18,2.6vw,28)→clamp(16,2.2vw,22)`、列表 `0 14px 2px→0 12px 0`，
窄屏四条同步。560px 宽下整卡高度：约 1050 → 830 → **约 590px**。

**第十二轮 · 固定间距按缩小的字号重新配平。** 间隙是写死的 px，不跟字号走。量出来行内本来就不松
（抬头→例句 7px），空的是块与块之间，所以动的是词头块 `margin-bottom 26→18 / padding 18×22→14×18`、
例句面板 `clamp(22,3.4vw,40)→clamp(18,2.6vw,28)`、列表 `0 20px 8px→0 14px 2px`、每行
`padding 14/16→10/12、gap 7→5`、译文 `margin-top 5→3`、抬头 `12→8`（正面 `14→10`）、助记面板 `14→12`。
单行 143.8 → 129.8px。用 DOM 探针把每个块的高度与间隙画进截图量的，别靠眼睛估。

**第十一轮 · 修掉正面点例句喇叭的叠音。** 正面的点击处理只有 `currentTime=0; play()`，从来没停过
别的音频（背面一直有 `stopAll()`），连点两行就是两个声音同时放。正面补上 `players` + `stopAll(keep)`，
单词那颗也走同一条路（`mountAudio` 统一挂载）。两面另加兜底：`bindPlaying` 的 `play` 回调里
`sounding !== audio` 就立刻 `pause()`——Android WebView 上 `pause()` 可能赶在 `play()` 的承诺落地之前。
背面自动播单词的序列先置 `sounding = wordAudio` 再播，否则会被这道兜底当场停掉。
回归检查现在是 `tests/template-invariants.mjs` 的一项（打桩 `play`/`pause`，断言任何时刻在响的 ≤1）；
修复前正面报 OVERLAP x2。**兜底那半边的真实媒体事件仍只能手机上确认。**

**第十轮 · 例句行降噪。** 目标词从「黄底 + 2px 黑框」改成只有红色粗体——`<mark>` 有 UA 默认黄底，
删掉 `background` 声明不够，必须显式 `background: transparent`；`--mx-mark-bg/ink/line` 三个变量随之删除。
译文标注从红色粗体 2px 红实线改成跟随正文色的 1px 点状下划线（`.theme-bauhaus .mctx-gloss` 整条删除）。
例句行喇叭改用早就存在但没人用的 `.mctx-audio-btn--other`，24px → 20px、图标 13 → 11px；
单词那颗保持 28px。例句字号正反面统一 16px（窄屏 6 条 `.mctx-sentence*` 规则全部对齐）。

**第九轮 · 背面拆成例句与助记两个面板。** 「例句」只剩英文句 + 中文译文；每句 `Analysis{i}` 降级成
隐藏源 `.mctx-analysis-src`，由脚本归集到第二个 `.mctx-recap` 面板「助记」，`其他义项` 折叠块也搬进去；
两者都空时整块 `hidden`。同轮把行内喇叭移到行的右边缘，例句面板标题从「例句与翻译」改成「例句」。

**第八轮 · 删掉「全局释义」小标签。** 带边框的面板本身就是标签；块的上内边距 26/28/24px → 12/14/12px，
释义字号桌面 `clamp(19,2.4vw,25)`→`clamp(17,2.1vw,21)`、窄屏 `clamp(17,5.2vw,21)`→`clamp(15,4.4vw,18)`。
`.mctx-core-label` 的两条规则与 `position:relative` 一并删除。

**第七轮 · 全局释义改成词典式分栏**（对齐默默背单词）。背面脚本不再把词性复制到每一行，而是按词性分组：
`splitGroups()` 返回 `{pos, senses[]}`，词性一变即新起一组（同一词性被 `；` 重复写出时合并），渲染成
左侧词性方框徽标（只在组首出现、去掉句点）+ 右列义项逐行编号 ①②③（跨词性连续）。布局是
`.mctx-core-group` 的 flex 两列，义项列 `min-width:0`，窄屏换行挂在自己缩进下。

**第六轮 · 全局释义一个义项一行。** 按「；」和词性组之间的「 / 」拆开（括号内标点不拆），并把只写在
组首的词性带到后续行上。「全局释义」徽标改成块内左上角小标签，块因此多了 26px 上内边距。
（下一轮就被第七轮的分组布局取代——词性复制到每行会让 16 张卡里 10 张重复出现同一个 `n.`。）

**第五轮 · 例句字号整体下调并统一正背面。** 手机正面 21px、背面 18px → 都是 17px；桌面收到 19px 上限；
中文译文 16→15px。坑：有一条同权重、排在最后的 `.theme-bauhaus.mctx-card--front .mctx-sentence`
专门管正面窄屏字号，只改 `.theme-bauhaus .mctx-sentence` 是改不动正面的。

**第四轮 · 撤回上一轮对正面词头面板的"瘦身"。** 正反面观感不一致比首屏少一行更难受，改为正背面共用
同一块带红顶条的边框面板。同时删掉那条漏写 media query 的 `.theme-bauhaus.mctx-card--front { padding }`
（它在宽屏也生效，把只在窄屏让位装饰的 48/54px 覆盖成 26/34px）。

**第三轮 · 背面自动播放改为只播单词**（例句一律手动点喇叭）；`:hover` 收进 `@media (hover: hover)`
——触屏点按会把 `:hover` 一直留在按钮上，就是"播完还红着、点别处才恢复"的真因；每行音频元素改为挂进
DOM 的 `<audio>`（游离 `new Audio()` 在 Android WebView 上 `ended` 不保证派发）。

**第一轮/第二轮 · 正面一次显示全部例句**（不再轮换、无 shuffle bag、无 localStorage 状态）。
