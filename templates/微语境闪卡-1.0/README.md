# 当前集合里的模板（只作留痕与回滚）

这三份文件是 `微语境闪卡 1.0` 笔记类型在 Anki 集合中的**当前** Front / Back / CSS 副本。
2026-10-06 起改为：正面一次显示全部例句（不再轮换、无 shuffle bag、无 localStorage 状态），
背面以 `ChineseCore` 大字为第一焦点，每行语境给出「英文句 + 中文译文（`【…】` 渲染成下划线，
悬停显示该组 `Meaning`）+ 搭配解析」，自动播放顺序为 词 → 全部例句。

**本 skill 的脚本不写模板**，也不从这里读取。改模板请走 `anki-card-template-design` 的流程：
快照 → 离线渲染验证 → `updateModelTemplates`（整表回传）+ `updateModelStyling` → 逐字节读回比对。
`SentenceCN{i}` 里的 `【…】` 是这套渲染的契约，由 `scripts/note-rules.mjs` 校验（缺失出警告）。
