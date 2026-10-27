# Knowledge Curator V0.2 Phase 1 — Simplified Workflow Report

日期：2026-10-27。代码与离线验证已完成，真实外部 AI GUI 全链路待授权。

## 1. Product Change Document

`docs/product/knowledge-curator-v0.2-phase1-product-change.md`；PRODUCT_CHANGE_DOC = UPDATED。包括五类只读审计输出、原设计、实际结果、差异和限制。

## 2. Original User Problems

同篇文章多 action、内部术语与模式暴露、首次使用无清晰顺序、多个维护入口，Graph 缺乏易懂展示。

## 3. Product Goal

普通用户配置 AI 和 raw/wiki 后，一次点击完成文章分析、知识点整理、受校验的知识更新与关系构建。

## 4. Before User Journey

文章 → 分析 → 查看分析 → 验证冲突 → 生成建议 → Preview → Accept/确认 → 分开的索引/Graph/时效维护。

## 5. New User Journey

配置 AI → 配置 raw/wiki → 放入文章 → 打开/选择文章 → 一键分析文章 → 文章分析/知识点/知识关系。无增量、拒绝摄入或验证不允许时不伪称已写入。

## 6. Main Sidebar Changes

移除开发状态、模式和索引统计；一主按钮、文章列表、当前文章结果。列表独立限高、元数据加载、多侧栏独立刷新。

## 7. One-click Analysis Workflow

自动准备现有 Wiki 索引 → Source Analysis → Extraction/Retrieval/Comparison → 可选 Conflict/Freshness → 生成并验证 Knowledge PR → normal Wiki Write/History/reindex → Graph。显示四种自然语言 progress。写入前检测文章/设置中途变化；识别同来源已接受记录避免重复写入。

## 8. Article Card Changes

整体可点击，标题/日期/四态/箭头；选择时打开 Markdown、恢复现有分析，不调用 AI；移除卡片独立分析/打开/PR 按钮。

## 9. Article Status Model

待分析、分析中、已分析、分析失败。映射内存运行态与现有分析缓存；不显示 candidate/cache/graph state。

## 10. Article Analysis Result

质量、冲突、重复、时效性来自现有分析、比较、核验及本地风险服务。共享分析字段由偏好控制展示，独立核验受开关控制。缺外部搜索配置明确标为未完成外部核验。

## 11. Knowledge Point UI

只显示知识内容、实际来源、匹配到的 Wiki 及实际索引更新时间，不展示原始 ID/confidence。缺数据不伪造。

## 12. Knowledge Relation Mind Map

主题中心 + 简单树形分支，保留边方向，节点可展开查看来源文档；支持/补充、细化、冲突、依赖、重复。只显示模型建议，不自动压缩或修改 Markdown。

## 13. Claim Terminology Hidden

主要侧栏和普通设置删除 Claim/Claim Store/Claim Mode/Legacy Mode/Test/Preview/Top K 等标签，内部类型、服务和存储命名保留。

## 14. Runtime Mode Simplification

新产品默认 normal + claim；旧字段可读、不导致启动失败。显式 backend test/production-preview/legacy 仍存在，原只读服务调用仍不能写入。

## 15. Write Safety

新增显式配置 Wiki root，兼容原固定测试 root；禁止绝对/穿越/隐藏/根路径与资料目录重叠。保留 source/target fingerprint、create 碰撞、唯一 before、最小变更、证据授权、冲突替换门禁、读回、History 和失败回滚。无新建完整 Undo engine。

## 16. Settings Simplification

知识范围、AI 服务、分析偏好、知识维护。七项偏好、清晰隐私说明、可选搜索密钥；保持现有 Base URL/API Key/模型架构。

## 17. Knowledge Maintenance Changes

更新知识索引 + 一个清除分析缓存入口；独立关系/时效任务进入编排器。已接受历史和索引不因清缓存被删除。

## 18. Backend Changes

兼容扩展：AnalysisService 可显式允许空库/跳过提取，VaultService normal 包含 raw 且只读元数据，PR/validator/writer 接收可配置写入 root，新增产品编排层。无第二套 AI 分析算法。

## 19. Preserved Backend Components

Claim schema、Store/Graph repositories 与格式、枚举、Retrieval/Comparison/Relation/Freshness 算法、Prompt、Provider、Legacy 分支、维护 PR 服务、评测数据与校准策略均保留。无新 runtime dependency。

## 20. V0.1.3 Compatibility

V0_1_3_DATA_COMPATIBILITY = PASS。使用从 99c035c 基线生成并经旧 validator 校验的序列化 Graph 样本与脱敏旧设置/Claim Store；覆盖旧 preview/legacy、损坏缓存、新偏好补默认。dev vault 的旧缓存可在新界面展示。未宣称全面真实库认证。

## 21. Files Changed

核心文件及作用见产品文档第 19 节，完整清单见该提交。仅本轮 src/product、controller、view、settings、配置/写入接口、样式、测试和产品文档；不包含个人设置或原始文章。

## 22. Tests

TEST_TOTAL = 355；TEST_PASS = 355。另本地文件子测试 8/8；npm test 两组总计 363/363。新增 41 个功能测试，包括真实服务合成数据集成链路、卡片/Tab 行为、目标选择、失败/并发、路径边界、normal 下原回滚和 0.1.3 兼容。Typecheck = PASS。

## 23. Regression

REGRESSION_TOTAL = 134；REGRESSION_PASS = 134；PASS_TO_FAIL = 0。未重写 baseline、数据集或算法来消除失败。

## 24. Build

preflight、typecheck、build、bundle verification = PASS；版本仍 0.1.3。只部署 main.js、manifest.json、styles.css 到 `/Users/asus/Desktop/knowledge-curator-dev/.obsidian/plugins/knowledge-curator/`，逐文件 SHA-256 验证。先备份 dev 插件和设置；未覆盖 MyWiki。

正式源码在 `/Users/asus/Projects/knowledge-curator-obsidian`；先前留在 dev 插件目录的旧源码不作为本轮基准。后续修改从正式 feature 分支构建，再复制上述三文件到 dev vault；无需从旧副本重新构建。

## 25. Community Scanner Regression

源码核查通过：onunload 无 detach；Settings 用 Setting.setHeading 且 heading 无插件名；manifest description 无 Obsidian；无 remote executable/self-update/runtime dependency installation。未再次提交 Community Scanner，不能将源码回归核查称为远端扫描通过。

## 26. Manual GUI Test Checklist

- [x] Obsidian 1.14.5 中加载 dev build。
- [x] 新侧栏文案、唯一主按钮、文章列表与限高布局。
- [x] 卡片选择可打开对应 Markdown，读取旧分析缓存。
- [x] 三个结果 Tab 入口可见，文章分析值可读。
- [x] Settings 四组内容与模式入口移除。
- [x] 自动化 host 交互测试：卡片、知识点展开/来源按钮、Tab 键盘导航、空态、错误与重试。
- [ ] 实机逐 Tab/非空关系图交互完整回归（当前图未建立，部分 native UI 自动化出现无效节点）。
- [ ] 真实 DeepSeek 分析 → 自动写 Wiki → reindex → Graph → 重复运行不重写。
- [ ] 真实外部搜索冲突/时效核验（当前无搜索密钥）。
- [ ] 新用户首次配置、已有 Wiki 更新、异常网络下恢复、深色主题的完整人工体验。

实机一键分析被自动审批拒绝，原因是所选文章/相关 Wiki 会发送至配置的 DeepSeek 服务并可能写入 dev Wiki；请求未执行，也未通过其他途径绕过。离线真实服务集成测试使用纯合成数据与内存响应，不能替代真实 Provider 质量验收。

## 27. Feature Branch

`feature/v0.2-simplified-workflow`。从干净 main 完成 ff-only 同步后新建；main 和 0.1.3 发布不变。

## 28. Commit

提交主题：`feat: simplify Knowledge Curator user workflow`。本报告随实现一并提交；确切提交标识与远端核验结果见交付消息。不创建 tag、Release 或合并 main。

## 29. Known Limitations

轻量关系树，无完整 Undo；关系只来自 Wiki 索引，未写入内容不一定有关系；本地时效不等于外部事实认证；新 Wiki 初次索引可能较慢；旧 Legacy 缓存缺知识点提取时需重新分析；写后校验/恢复异常仍需检查 Wiki。真实外部 AI 全链路待明确授权，GUI 仅部分验收。

## 30. Deferred Items

用户 Undo、复杂图编辑、Provider selector/presets、批量分析、全局 Dashboard、Onboarding、warning cleanup；无 Phase 2 实施、版本升级、RC 或 Community Release。

## 31. NEXT_PHASE_RECOMMENDATION

先授权并完成 dev vault 的真实端到端体验，重点检查创建、更新、重复、未核验冲突、失败恢复和思维导图是否易懂，再收用户反馈。Phase 2 尚未启动。

PRODUCT_CHANGE_DOC = UPDATED
V0_1_3_DATA_COMPATIBILITY = PASS
PHASE_1_IMPLEMENTATION = PARTIAL

STOP：代码、离线检查和本地开发构建已就绪；外部 AI 真实链路及剩余手动体验待验收。
