# 当前集合里的模板（只作留痕与回滚）

这三份文件是 `微语境闪卡 1.0` 笔记类型在 Anki 集合中的**当前** Front / Back / CSS 副本。
2026-10-06 起改为：正面一次显示全部例句（不再轮换、无 shuffle bag、无 localStorage 状态），
2026-10-06 第五轮：例句字号整体下调，并把正背面统一。手机（≤560px）正面原来 21px、背面 18px，
现在都是 17px；桌面从 clamp(21,3vw,33)/clamp(19,2.4vw,26) 收到 19px 上限；中文译文 16→15px，解析保持 13px。
注意有一条同权重、排在最后的 `.theme-bauhaus.mctx-card--front .mctx-sentence` 专门管正面窄屏字号，
只改 `.theme-bauhaus .mctx-sentence` 是改不动正面的。

2026-10-06 第四轮：撤回上一轮对正面词头面板的"瘦身"——正反面观感不一致比首屏少一行更难受，
现在正面与背面共用同一块带红顶条的边框面板（词 + 喇叭一行、IPA 一行），背面只是在同一块里多一行「全局释义」。
同时删掉了那条漏写 media query 的 `.theme-bauhaus.mctx-card--front { padding }`（它在宽屏也生效，
把原本只在窄屏让位装饰的 48/54px 覆盖成了 26/34px）。

2026-10-06 第三轮：背面自动播放改为**只播单词**（例句一律手动点喇叭）；`:hover` 收进
`@media (hover: hover)`——触屏上点按会把 `:hover` 一直留在按钮上，就是「播完还红着、点别处才恢复」的真因；
每行音频元素改为挂进 DOM 的 `<audio>`（游离 `new Audio()` 在 Android WebView 上 `ended` 不保证派发）。

背面以 `ChineseCore` 大字为第一焦点，每行语境给出「英文句 + 中文译文（`【…】` 渲染成下划线，
悬停显示该组 `Meaning`）+ 搭配解析」，自动播放顺序为 词 → 全部例句。

**本 skill 的脚本不写模板**，也不从这里读取。改模板请走 `anki-card-template-design` 的流程：
快照 → 离线渲染验证 → `updateModelTemplates`（整表回传）+ `updateModelStyling` → 逐字节读回比对。
`SentenceCN{i}` 里的 `【…】` 是这套渲染的契约，由 `scripts/note-rules.mjs` 校验（缺失出警告）。
