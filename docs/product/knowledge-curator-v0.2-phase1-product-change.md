# Knowledge Curator V0.2 Phase 1 — 产品优化变更说明

文档状态：PRODUCT_CHANGE_DOC = UPDATED。日期：2026-10-27。
开发分支：feature/v0.2-simplified-workflow；基线 main 0.1.3。这是本轮产品变更 Source of Truth，完成后回填实际结果。版本保持 0.1.3，不合并、不打 tag、不发布。正式源码位于 /Users/asus/Projects/knowledge-curator-obsidian；唯一手动测试 vault 为 /Users/asus/Desktop/knowledge-curator-dev。

## 1. FIRST AUDIT — 当前实现

### CURRENT_PRODUCT_FLOW

src/main.ts 的 ribbon 与 open-knowledge-curator-sidebar 命令通过 CuratorController.activateView 打开右侧 knowledge-curator-sidebar。Settings 由 KnowledgeCuratorSettingTab 注册。VaultService.scanInbox 递归发现配置目录的 Markdown，按 mtime 排序；CuratorController 将运行态和 AnalysisCacheService 的有效缓存叠加到列表，缓存受文件时间、检索范围、索引 revision/算法版本约束。缓存和设置在插件 data.json；Claim/Graph/维护状态在 .knowledge-agent 下独立持久化。

AnalysisService.analyzeSource：检查 Inbox 边界 → 读取并截断正文（24,000 字符）→ RetrievalService 限制相关上下文 → LlmService Source Analysis → ClaimExtractionService → ClaimRetrievalService → ClaimComparisonService → aggregateClaimAnalysis。Claim 模式目前在索引为空时拒绝分析；Legacy 分支保留文档分析。ClaimStoreService.build 按 Wiki 内容 hash 增量提取，支持取消、失败重试、reindexWiki；ClaimStoreRepository 读写 schema 1。比较有缓存、批处理和确定性 guards。

ConflictVerificationService.verifyAll 通过搜索服务、证据排序、LLM 与验证缓存完成外部核验，并使旧草稿失效。MaintenanceService.scan 使用 FreshnessRiskService 本地扫描；FreshnessVerificationService 提供按知识点的外部证据核验。KnowledgePRService 生成最小变更；KnowledgeWriteService.accept 经过校验后写 Wiki、记录 History 并 reindexWiki。ClaimGraphService 使用已有索引、候选生成、关系分类、GraphRepository（schema 2）、演化记录建立派生关系；关系是模型建议，压缩自动写入仍被质量门禁禁止。

旧体验：文章 → 分析 → 查看分析 → 验证冲突（如有）→ 生成知识更新建议 → 预览 → Accept 确认 → 另行索引/Graph/时效维护。不是一键完成。

### CURRENT_UI_ACTIONS

一级导航：待处理文章、知识维护、知识关系建议。卡片：打开、分析、查看分析、生成/查看更新建议（依状态）。详情：返回、重新分析、冲突验证、生成更新、接受、拒绝。维护：扫描时效、验证知识、生成维护更新。Graph：构建关系、验证冲突。设置暴露运行模式、比较模式、Top K、各类缓存、索引与 Graph 构建。一个知识更新至少经过分析、生成建议、接受及确认，多处跳转。

### CURRENT_DOMAIN_ARCHITECTURE

View → CuratorController → Analysis/PR/Verification/Write/Index/Graph services → LlmService/SearchProvider/Vault adapter/Repositories。保留 Claim schema、Claim Store、Graph Store、Relation enum、Retrieval/Comparison/Prompt、Provider、Evaluation/Human GT/Calibration。新产品层通过 orchestrator 和 display mapper 组合既有能力，不全仓 rename Claim。

### CURRENT_WRITE_SAFETY

现有 mode=test 才可接受；production-preview 只读。write-scope-guard 默认硬编码 KnowledgeCuratorPhase1Test/wiki。PR 生成与 validator 同样使用此边界。写入校验 source/target mtime+SHA256、create 冲突、唯一 before、小范围 changes、来源/证据授权、REINFORCE 禁写、SUPERSEDE 外部证据；写后读回；History 持久化失败尝试恢复旧正文或删除新建文件。History 保存 before/after hash 与变更片段，不是完整版本快照；无完整用户主动 Undo 引擎。不能声称已有全量备份或完整撤销。

### CURRENT_TECHNICAL_TERMS_EXPOSED_TO_USERS

MVP COMPLETE、Claim Graph 人工复核、Claim Store、Claims/Indexed Wiki/Failed、Claim Mode/Legacy Document Mode、测试模式/正式知识库预览、Candidate、Top K、Comparison、Freshness Risk、History、内部 relation/confidence 和缓存名。

## 2. 背景

MVP 已有 Source Analysis、Claim Extraction、Claim Comparison、Conflict Verification、Freshness Verification、Knowledge PR、Claim Graph/Relation、Wiki Update。问题集中在入口过多、技术概念暴露、首次不知道先点什么、同篇文章多个 action、Claim/Claim Store 认知负担、Test Mode/Production Preview 强迫用户理解内部运行方式、Graph 缺少易懂可视化、Settings 像工程控制台。不是继续补底层 Agent 能力。

## 3. 本轮产品目标

> 将 Knowledge Curator 从技术验证型 MVP 收敛为普通用户可直接使用的一键知识治理工具。

> 用户把文章放入 Vault 后，只需要点击一次“一键分析文章”，即可完成文章质量分析、已有知识比较、冲突/重复/时效判断、知识点提取、知识库更新和知识关系构建。

仅在有可维护增量且验证允许时更新；全重复、不摄入、证据不足不可伪装为已写入。部分完成必须显示已完成写入与未完成索引/关系，禁止盲目重复写入。

## 4. 非目标

不重写 Claim schema、Retrieval algorithm、Relation Model，不大规模 Prompt 调优、不更换 Provider architecture、不删除 Legacy backend、不重建 Evaluation Dataset、不改 Graph calibration、不开发复杂 Graph editor、不做 Community Release/0.2.0 bump，不触碰真实 MyWiki。

## 5. 用户问题 Before

文章 → 分析 → 查看分析 → 生成知识更新建议 → Preview → Accept → Claim Store → Claim Graph → Freshness。用户必须理解多项系统内部概念和模式。

## 6. 用户体验 After

配置 AI → 配置 raw/wiki → 把文章放进 raw → 选择/打开文章 → 一键分析文章 → 文章分析（质量/冲突/重复/时效性）→ 知识点 → 自动更新知识库 → 知识关系思维导图。

## 7. 核心信息架构变化

| Before | After |
| --- | --- |
| Claim | 知识点 |
| Claim Store | 内部实现 / 知识索引 |
| Claim Graph | 知识关系思维导图 |
| Claim Comparison | 已有知识比较 |
| Conflict Verification | 冲突检测 |
| Freshness Risk | 时效性 |
| Relation Suggestion | 知识关系 |
| Test Mode / Production Preview / Legacy Document Mode | 普通 UI 删除 |

内部 domain model 不随 UI 全面 rename。使用 ViewModel/mapper 映射。

## 8. 主界面变化

标题 Knowledge Curator + “把文章整理成可维护的知识点”。删除开发状态与模式。唯一 Primary CTA“一键分析文章”，优先 active Markdown（在待处理/raw 范围），否则 selected article，否则“请先选择一篇待分析文章”。卡片整体点击更新选择、打开文件并展示缓存；只显示 title/date/status/chevron。状态：待分析、分析中、已分析、分析失败。详情三个 Tab：文章分析、知识点、知识关系。活动文件变更不触发 AI 请求。

## 9. Settings 变化

仅四组：知识范围、AI 服务、分析偏好、知识维护。保留待处理目录、原始资料目录、Wiki 目录；AI Base URL/API Key/模型；隐私说明“分析时仅会将当前文章和少量相关知识发送到你配置的 AI 服务，不会上传整个 Vault。”另如有外部搜索则只发查询，必须明确搜索尚未配置时的能力边界。
分析偏好：内容质量、知识冲突、重复知识、时效性、提取知识点、更新知识库、生成知识关系思维导图。部分分析由单次结构化请求提供，不伪称可单独关闭同请求中的算法；开关控制展示或独立服务执行，并明确依赖（自动写入依赖提取）。知识维护：更新知识索引（重新扫描 Wiki，更新用于知识检索的本地索引）、清除分析缓存（合并派生缓存，不删持久索引或历史）。移除模式、Top K、独立关系生成/时效扫描入口。

## 10. 一键分析 Workflow

Article → Source Analysis → Knowledge Point Extraction → Relevant Knowledge Retrieval → Comparison → Quality/Conflict/Duplicate → Freshness → Relation Generation → Wiki Update → Knowledge Index Refresh。产品层复用 AnalysisService 合并阶段，写后基于最终索引更新 Graph，避免展示写前过期关系。用户 progress：“正在分析文章…”、“正在检查已有知识…”、“正在整理知识点…”、“正在更新知识库…”。
空索引自动增量建立；空 Wiki 允许首篇知识写入。失败索引不能悄悄视为知识不存在。冲突外部核验复用已有服务；没有搜索配置时明确“未做外部核验”，仍受未核验冲突不可 replace 的原校验约束。时效本地扫描与外部核验区分，不能把近期文件时间当作事实时效已验证。自动写入后失败重试须识别已完成写入，不能重复添加。

## 11. 写入策略变化

Before：Test Mode/Production Preview/Accept。After：Normal Mode → 一键分析 → 正常写入配置的 Wiki。新增 normal 语义，兼容旧配置读取；旧模式不再成为普通用户开关，旧字段保留可读与调试兼容。旧测试/预览调用仍受原限制；产品入口固定 Claim 分析。
保留 path/write guard、before-after/hash、历史、写后验证、记录失败回滚、确定性校验。配置路径必须是 vault 内非隐藏文件夹，禁止绝对路径、穿越、URL、根目录、raw/inbox 重叠；写入仅限 Wiki 的 Markdown。“删除用户层模式切换”不等于“删除安全机制”。没有完整 Undo，本 Phase 不新建 rollback engine、不显示虚假撤销按钮。

## 12. 知识点与知识关系

知识点只显示内容、已有来源、对应 Wiki、更新时间，不显示 ID/raw confidence/内部枚举；无数据不伪造。
内部 Claim Graph supports/refines/contradicts/depends_on/duplicate → UI“支持 / 补充”“细化”“冲突”“依赖”“重复”。当前文章/主题为中心，知识点为节点，简单 tree/mind-map，节点可点击查看来源与 Wiki；关系仍标明模型建议而非事实，绝不自动压缩、合并、删除 Markdown。无关系“暂未发现知识关联”。无知识点“暂未提取到可维护的知识点”。

## 13. 空态、加载、失败

无文章“待处理目录里还没有文章”；缺目录说明配置路径。四阶段用户 progress。失败“分析失败”+可理解原因+“重新分析”（复用唯一主按钮，不增加第二 Primary CTA）。Console 保留完整错误，普通 UI 不显示 stack/raw JSON/provider response/internal exception。中途已写入须如实提示，不能显示“未发生修改”。

## 14. 风险

默认写 Wiki 误写风险；长链路延迟/中断/重复点击；旧 UI 行为改变；隐藏 Legacy 后调试成本；Mind Map 与 Relation Model 语义映射风险；内部 Claim 数据泄漏；旧数据兼容；写后索引/关系失败；初次扫描可能调用多次 AI。用边界校验、全链路互斥、写后历史恢复与明确的部分完成状态处理。

## 15. 兼容性

不迁移 Claim schema、不破坏 Claim/Graph Store。0.1.3 settings/cache/旧 mode 字段可以读入，损坏缓存不得导致启动失败；Wiki 不需要 migration。normal 是新增产品默认，旧预览字段不因隐藏 UI 而绕过旧只读调用。对旧版数据与空索引分别测试。V0_1_3_DATA_COMPATIBILITY = PASS（0.1.3 基线序列化样本与 dev vault 旧设置/缓存读取；不等于所有真实用户库全面验收）。

## 16. 验收标准

新用户只需 1 配置 AI；2 配置 raw/wiki；3 文章放 raw；4 打开/选择文章；5 点击“一键分析文章”。看到文章分析、知识点、知识关系思维导图。无需理解 Claim/Claim Store/Claim Mode/Legacy Mode/Test Mode/Production Preview。写入只到指定 Wiki，兼容旧记录；无配置不发送请求。键盘可选择文章与 Tab，轻/深色与窄侧栏可读。

自动检查：preflight:local-files、typecheck、test、regression、build；记录 TEST_TOTAL/PASS、REGRESSION_TOTAL/PASS、PASS_TO_FAIL。核查 unload 不 detach、Setting.setHeading 不含插件名、description 无 Obsidian、无远程可执行/自更新/运行时依赖安装。手动仅 dev vault；不以构建通过等同实机端到端 AI 验收。

## 17. 后续 Phase 候选

自动 Undo/Rollback UX、Provider selector、DeepSeek/OpenAI preset、Mind Map 高级交互、Warning cleanup、批量分析、全局 Dashboard、Onboarding。最终推荐须依据本轮结果。Phase 1 后 STOP，等待用户体验反馈。

## 18. 实际实现结果

### 完成项

- 新增 OneClickAnalysisOrchestrator 与 workflow-presenter；主侧栏只有一个分析主按钮，优先活动 Markdown，回退已选文章。
- 卡片只保留标题、日期、四态和箭头，整体可点击；点击选择/打开文章并恢复结果，不触发 AI。
- 三个结果 Tab：文章分析、知识点、知识关系；四类分析值复用已有结果。来源、对应 Wiki、索引更新时间有数据才显示。
- 关系以文章主题为中心，树形分支呈现原 Graph 边，保留方向并使用五类中文标签；节点可以展开和打开文档。
- 四组 Settings、七项偏好、合并缓存入口、更新知识索引。搜索密钥收进 AI 服务内的可选外部核验，未重做 Provider 框架。
- 新普通流程读入旧配置，统一 normal + claim；默认待处理目录 raw。旧 test/preview/legacy 仍可作为 backend API 显式输入，旧预览写入仍被拒绝。
- 增量准备索引，空 Wiki 可以首篇分析；索引失败明确停止，避免把未索引知识当成不存在。
- 新增配置 Wiki root 参数，保留原测试 root 默认，写前检查资料/Wiki 互斥、路径范围、来源和目标指纹；沿用 validator、写后读回、History 与原回滚。
- 并发互斥、卸载前写入取消检查、设置/文章中途变化检查。已接受且源 hash 未变的更新不重放；旧测试 Wiki 接受记录不会当作新 Wiki 的更新。
- 修复实机发现的云端正文读取阻塞列表：normal 列表只读元数据。修复多个保留侧栏叶片的扫描互相取消，逐视图独立刷新。列表限制高度，让结果保留可见空间。

### Partial 项

实机 GUI 已核对主侧栏、文章列表、卡片打开 Markdown、0.1.3 缓存结果、三个 Tab 入口、四组设置及自然语言说明。真实外部 AI → 自动写入 → 关系生成的完整 GUI 验收未执行：自动审批拒绝了点击“一键分析”，因为会向已配置的 DeepSeek 服务发送所选文章和相关知识，并可能更新开发 Wiki。没有通过其他路径发送这批数据。

### Deferred 项

完整用户 Undo、复杂图编辑器、Provider presets、批量处理、全局 Dashboard、Onboarding、warning cleanup 和 Phase 2 均未进入。

### 与原设计不同之处

1. 索引准备在正式分析前；Graph 在最终 Wiki 写入及索引更新后构建，以免展示过期关系。
2. 内容质量/冲突/重复共用既有 Source Analysis 与比较结果，开关控制展示/独立核验，不假称能拆开同次结构化请求；关闭提取时不自动写入/生成关系。
3. 时效分为当前文章的本地风险评估、相关已有知识的可选外部核验；后者最多处理 3 个高风险相关点。无搜索配置时明确未完成外部核验。
4. 没有完整 Undo UX；保留原失败回滚及变更片段/Hash 历史，不声称已有持久化全量备份。
5. 正式源码按本轮要求放在 Projects 仓库；dev vault 仅更新 main.js/manifest.json/styles.css，先前复制在插件目录中的旧源码不作为本轮开发基准。

## 19. 文件变更

| 文件/目录 | 作用 |
| --- | --- |
| src/product/one-click-analysis-orchestrator.ts | 产品编排、偏好、互斥、已写入结果恢复与部分失败提示 |
| src/product/workflow-presenter.ts | 目标选择、四态、知识点、中文关系、空态、安全错误文案 |
| src/controllers/curator-controller.ts | 接线已有服务、卡片选择、索引准备、来源/设置一致性、缓存恢复 |
| src/views/curator-view.ts / styles.css | 单主入口、卡片、三个 Tab、可点击关系树、窄侧栏样式 |
| src/settings.ts | 四组设置、合并缓存、索引更新、隐私说明 |
| src/main.ts | 实例接线与 vault 事件；保留 unload 行为 |
| src/types/settings.ts / src/services/settings-migration.ts | normal、偏好与旧字段兼容 |
| src/services/analysis-service.ts / vault-service.ts | 空库首次分析、可选提取、raw 范围、元数据列表 |
| src/services/write-scope-guard.ts / knowledge-pr-service.ts / knowledge-pr-validator.ts / knowledge-write-service.ts | 兼容的可配置 Wiki 范围，保留原校验和回滚 |
| tests/*workflow* / *presenter* / *compatibility* / *integration* / fixtures / obsidian-ui-stub.ts | 产品、UI、完整服务链路和旧数据测试 |
| scripts/run-tests.mjs | 注册新测试与 host double，依旧禁止测试意外真实网络请求 |
| tests/analysis-service-claim-mode.test.ts / knowledge-write-service.test.ts / settings-migration.test.ts / write-scope-guard.test.ts / claim-graph-release-boundary.test.ts | 新产品语义及原安全机制回归 |
| 本文及 implementation-report.md | 产品 Source of Truth、完整 31 项交付报告 |

## 20. 测试结果

| 检查 | 结果 |
| --- | --- |
| preflight:local-files | PASS |
| typecheck | PASS |
| npm test（功能测试） | TEST_TOTAL = 355；TEST_PASS = 355 |
| npm test（本地文件子集） | 8 / 8，以上两组合计 363 / 363 |
| regression | REGRESSION_TOTAL = 134；REGRESSION_PASS = 134；PASS_TO_FAIL = 0 |
| build / bundle verification | PASS；runtime external module 仅 obsidian |
| 0.1.3 数据兼容 | PASS，固定基线脱敏样本与实机旧设置/缓存可读 |
| Manual GUI | PARTIAL，已核对产品表面；真实 AI 自动写入全链路等待明确授权 |

新增 41 项功能测试；原测试中模式默认值预期按产品设计调整，旧显式 preview 只读服务测试保留。离线完整服务集成测试使用内存文件系统及合成 AI 回应，实际调用 Analysis/Extraction/Retrieval/Comparison/PR/Write/History/Index/Graph；验证空 Wiki 首次创建与重复运行不重写，不能等同于真实 Provider 质量验收。

扫描回归：onunload 无 detach；Settings 用 Setting.setHeading，标题不含插件名；manifest description 无 Obsidian；无远程 executable、自更新或运行时安装依赖。Claim/Graph schema、存储格式、算法、Provider、Prompt、数据集与 calibration 均未改动。两个 UI/mode 相关测试随预期产品变更调整，不将此作为历史缺陷修复数字。

## 21. 已知限制

- 未取得本次真实文章发送到 DeepSeek 的明确许可，外部 AI 全链路实机验证未完成；未配置搜索密钥，也未验证真实外部冲突/时效搜索。
- 关系树为轻量只读展示和文档跳转；没有拖动、缩放或自动压缩。
- 新关系来自已索引 Wiki；未开启知识库更新时，未写入知识点未必能进入持久 Graph，关系空态不能证明文章之间无关系。
- 索引可能触发对配置 Wiki 内变更文件的 AI 提取；文案已单独说明。大 Wiki 初次建立仍可能较慢。
- 旧 Legacy 分析缓存可读，但不含原子提取结果时，时效显示信息不足；重新分析才得到新结果。
- 运行中的结果/失败进度在内存；文章分析与已接受更新由既有缓存/History 持久化。重启恢复会重新计算本地时效，不伪造已验证状态。
- 原写后校验失败/回滚失败仍需人工检查 Wiki；本轮不新建事务或全量版本回滚引擎。
- 手动加载时当前 Obsidian 安装程序 1.11.7 + 应用 1.14.5 的 CLI/窗口自动化出现异常，vault 重开后可显示新版；未擅自更新应用或清空用户 workspace。

## 22. 下一阶段建议

先在 knowledge-curator-dev 完成一次真实服务分析/创建、再次分析不重复写入、更新已有 Wiki、冲突不确定时不替换及来源/目标变动阻断的验收。先收用户反馈，暂不进入 Phase 2。
若验收稳定，优先验证可追溯撤销交互与索引/关系部分完成恢复的需求，再决定高级关系图或 Provider presets；不要跳过当前体验去新增底层能力。

PRODUCT_CHANGE_DOC = UPDATED
V0_1_3_DATA_COMPATIBILITY = PASS
PHASE_1_IMPLEMENTATION = PARTIAL

代码、离线验证与本地构建已完成；真实外部 AI 全链路 GUI 验收待授权。未 merge main、未 bump、未 tag、未 Release。至此 STOP。
