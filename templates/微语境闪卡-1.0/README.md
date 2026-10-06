# 当前集合里的模板（只作留痕与回滚）

这三份文件是 `微语境闪卡 1.0` 笔记类型在 Anki 集合中的**当前** Front / Back / CSS 副本。
2026-10-06 起改为：正面一次显示全部例句（不再轮换、无 shuffle bag、无 localStorage 状态），
2026-10-06 第三轮：背面自动播放改为**只播单词**（例句一律手动点喇叭）；`:hover` 收进
`@media (hover: hover)`——触屏上点按会把 `:hover` 一直留在按钮上，就是「播完还红着、点别处才恢复」的真因；
每行音频元素改为挂进 DOM 的 `<audio>`（游离 `new Audio()` 在 Android WebView 上 `ended` 不保证派发）。

背面以 `ChineseCore` 大字为第一焦点，每行语境给出「英文句 + 中文译文（`【…】` 渲染成下划线，
悬停显示该组 `Meaning`）+ 搭配解析」，自动播放顺序为 词 → 全部例句。

**本 skill 的脚本不写模板**，也不从这里读取。改模板请走 `anki-card-template-design` 的流程：
快照 → 离线渲染验证 → `updateModelTemplates`（整表回传）+ `updateModelStyling` → 逐字节读回比对。
`SentenceCN{i}` 里的 `【…】` 是这套渲染的契约，由 `scripts/note-rules.mjs` 校验（缺失出警告）。
