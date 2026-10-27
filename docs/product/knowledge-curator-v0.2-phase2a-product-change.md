# Knowledge Curator V0.2 Phase 2A — 批量分析工作台与性能可观测性

日期：2026-10-27。基线：Phase 1 commit 1a7ef1f，未合并 main；本轮分支 feature/v0.2-batch-analysis。package/manifest 保持 0.1.3；不合并、升级、打 tag 或发布。

## 1. 修改前只读审计

### PHASE_1_CURRENT_UI

CuratorView 为单侧栏：标题、一个主按钮、文章列表、下方当前结果。private selected 同时代表当前文章，但还没有批量勾选。卡片为 button/aria-pressed，显示四态。三个 Tab：文章分析、知识点、知识关系；当前关系通过 articleRelations 从全局快照筛出当前文章相关边。Settings 已分知识范围、AI 服务、分析偏好、知识维护四组。样式 is-selected 与普通背景辨识度不足。

### PHASE_1_CURRENT_WORKFLOW

CuratorController.analyze 根据 active file 优先、selected 回退。OneClickAnalysisOrchestrator 顺序调用索引准备、现有 AnalysisService（Source Analysis/Extraction/Retrieval/Comparison）、冲突/时效核验、KnowledgePR、Write/History/reindex、Graph；一个流程互斥，已接受的未改来源避免重复写入。旧数据和 Legacy backend 保留，原路径/指纹/证据/写后读回与回滚机制存在。Phase 1 真实外部 AI GUI 全链路仍未授权验收，不因用户称完成而推定已验收。

### CURRENT_BATCH_CAPABILITY

没有 Batch Job、checkbox、多选、筛选、队列、进度统计和取消。当前 selected 不能承担批量状态。分析只返回到同页结果。

### CURRENT_ANALYSIS_METRICS

ClaimComparisonService.getLastMetrics 已记录 candidate 数、cache/fast-path/LLM candidate、调用/批次/重试与比较耗时；tokenUsage 只是可选类型，无实际赋值。Graph build 有候选对、分类、调用、耗时。LlmService.requestCompletion 可访问 provider JSON（可含 usage），但当前只抽取 choices/finishReason，不采集 token。不存在统一 article-level stage timer、持久化 metrics、成本配置或性能报告。

### CURRENT_CHANGE_HISTORY_SOURCE

HistoryService 写 .knowledge-agent/history/*.json，KnowledgePRHistoryRecord 含 sourcePath/targetPath、decision、changes（before/after/reason/sourceClaims）、createdAt/decidedAt、claimRelations 和 hash。count 只有数量；可通过已有 file store list/adapter read 扩展读取。记录没有可靠的原文章标题、全量文件快照或 REINFORCE 写入数，必须 optional/明确统计定义，不能伪造完整撤销。

### CURRENT_GLOBAL_GRAPH_SOURCE

ClaimGraphService.getSnapshot 返回整个 Graph Store 的 stats/nodes/edges，getNeighbors 可读全局邻接。节点有 sourcePath、topic（可选）、statement、createdAt 等；索引 ClaimRecord 的 provenance/updatedAt 可以补充已有元数据。不需要新 AI 聚类。

## 2. Phase 2A 背景

Phase 1 已收敛技术术语、多按钮、单篇复杂路径与工程设置。仍缺批量选择、筛选、批任务状态、列表/详情分层、全局关系、可见修改记录和 pipeline 的 latency/token/pair/cost 可观测性。

## 3. 产品目标

> 将 Knowledge Curator 从“单篇知识整理工具”升级为“批量知识治理工作台”。

筛选未分析 → 多选/全选当前结果 → 分析所选 → 查看批任务进度 → 逐篇详情（文章分析/知识点）→ 全局知识关系图 → 变更记录。

## 4. 非目标及技术路线

不接 Jev、不换 LLM、不加 Rules classifier、不改 Relation 模型、Retrieval、Prompt、现有 Comparison scheduler/缓存/fast path。不新增高并发；文章串行，内部原比较批次调度不变。无 Community Release/0.2.0。

JEV_IMPLEMENTED = NO
RULE_CLASSIFIER_IMPLEMENTED = NO
TECH_SELECTION_STATUS = PENDING_BENCHMARK
Claim Comparison = EXISTING BASELINE

## 5. 批量选择和筛选

activeArticleId 独立于 selectedArticleIds:Set。普通行用当前主题的白/基础背景，当前查看行灰色，勾选为 checkbox + 紫色标记，两者可叠加。checkbox 与独立行按钮并列，不嵌套交互元素，不触发打开详情。
筛选：全部、未分析（默认）、已分析、分析失败。全选只作用于当前过滤结果，部分选择 indeterminate；取消当前结果不清除隐藏筛选里的选择。CTA 按当前筛选可见已勾选数计数，隐藏选择保留并提示；无勾选且未分析筛选时分析全部当前未分析。其他筛选未勾选时提示先选择。启动时冻结任务 ID；不隐式分析 active file、不选全 Vault。

## 6. Batch Job 和取消

BatchAnalysisJob: id/createdAt/articleIds/status/total/completed/running/failed/pending/currentArticleId/startedAt/finishedAt/tasks。Task: articleId/status/startedAt/finishedAt/error/metrics。
串行 1 article；单篇失败后继续；job 与 article 状态分离。任务 pending/running/completed/failed/cancelled 映射等待/处理中/完成/失败/已取消。取消是当前文章完整结束后不再开始后续任务，不伪称中断 LLM 或回滚已写入。卸载只取消后续，并继续保留原写入前 disposed guard。
显示已完成/处理中/等待/失败/已取消、已处理数（completed+failed）/total、当前文章与用户阶段。队列数据先在会话内，不自动恢复或重放中断任务。

## 7. Article IA 与分析维度

Before：文章列表 + 下方结果。After：文章工作台一级页 → 文章详情二级页 → 返回列表（保留筛选和勾选）。详情仅文章分析/知识点两个 Tab，完全删除局部关系 Tab。
文章分析维度可展开：质量、冲突、重复、时效性、新增/差异。基于现有 newClaims/comparisons/coverage 映射新增知识、补充知识；REINFORCE 仍不触发正文写入，只有已有 uncoveredAspects 才显示可确认的未覆盖内容，不把重复当新增。

## 8. 全局知识关系图

独立导航和命令入口，读取整个 Graph Store，不取 articleRelations。按已有 topic 或 Wiki 文件分组，默认折叠长原文，展示主题/文档、关键点和一级关系；无主题则用文档名，绝不造 AI 聚类。支持 pan、zoom、重置、展开/折叠、点击节点查看完整内容、Wiki、索引已有的来源文章、关系标签及更新时间。supports=补充/refines=细化/contradicts=冲突/depends_on=依赖/duplicate=重复。模型建议边界与不自动压缩机制保留。过期图明确提示，不伪称最新事实。

## 9. 变更记录

复用 .knowledge-agent/history，增加只读 UI model。列表显示时间、来源文件名（明确为文件名回退）、Wiki、可从 changes/relations 得出的新增/补充/冲突/跳过重复数量；无可靠值不编造。详情逐条 before/after/source/reason/time；before/after 为变更片段，不冒充完整文件快照。无完整用户 rollback，不放撤销按钮。坏记录隔离并提示有记录未读取，不中断整个列表。不新增第二套写入日志。

## 10. 性能 instrumentation schema

ArticlePerformanceRecord: runId/articleId/articleTitle/status/sampleKind（real/synthetic）、articleCharCount/articleTokenEstimate、claimExtractionCount、retrievalCandidateCount、deduplicatedPairCount、filteredPairCount、comparisonPairCount、llmComparisonPairCount、LLM 输入/输出/total tokens、tokenUsageSource（actual/estimated/unavailable）、各阶段及 totalLatencyMs、provider（hostname）/model、estimatedCost（默认 null）、requests（仅数量/时间/token/阶段，绝无 prompt/body/key）、errorCode（不存 provider body）。

阶段：sourceAnalysisLatencyMs、claimExtractionLatencyMs、retrievalLatencyMs、claimComparisonLatencyMs、freshnessLatencyMs、relationLatencyMs、wikiWriteLatencyMs；另记录 index/verification/proposal，避免成本或耗时被偷偷漏算。wikiWrite 包含既有 writer 的后续 reindex，单独注明；total 是整篇 wall-clock，不能简单相加推断并行阶段。

Provider usage 合法则记 actual prompt_tokens/completion_tokens/total_tokens；缺 usage 则按明确启发式估算 messages/content，并标 estimated；失败无响应时输出 token 不明，标 unavailable。混合来源以保守标签并附每次请求来源/缺失数。所有重试独立计数，传输失败/超时不伪称零消耗。比较阶段的 token/pair 独立保存，支持与整篇总量区分。

候选对定义：每个 candidate 的召回 match 数之和；deduplicated 为 candidateId+existingId 唯一对；filtered 为 cache/既有 fast-path 后没有进入 LLM 的候选对；LLM comparison pair 为实际进入原 LLM batch 的唯一对（另可记录含重试请求量），不把已返回的全部 comparisons 数误称 LLM pair 数。没有 match 的待判候选另记 llmCandidates，可能仍有 LLM 请求但 pair 数为 0。

## 11. 本地存储、价格和报告

运行数据仅写固定 KnowledgeCuratorValidation/performance/，不写 Wiki、不发送第三方、不提交 Git。源码 repo 和 dev vault 均沿现有 validation 体系忽略。开发者可提供同目录 cost-config.json，必须匹配 provider/model，设 inputPricePerMillion/outputPricePerMillion/currency；无合法配置 estimatedCost=null，绝不硬编码 DeepSeek 价格。

生成 KnowledgeCuratorValidation/reports/claim-comparison-performance.json 和 .md：Articles、Claims/均值、candidate/comparison pairs/均值、token/均值、comparison 和 total latency P50/P95、total tokens、raw records 和逐篇表。只将 sampleKind=real 的数据用于真实报告；synthetic 独立验证，不混进真实性能结论。0 样本写明无真实数据、null 百分位与空 raw，CURRENT_BOTTLENECK=INSUFFICIENT_DATA。少量样本明确量级，不作系统性优劣结论。

## 12. Phase 2B 设计（不执行）

Baseline 当前 DeepSeek pipeline；候选 A Rules Gate + DeepSeek，B Jev article router + DeepSeek，C Jev relation decision，D Rules + Jev + LLM fallback。将来在冻结数据、同模型上下文、冷/热缓存分开、统一并发与重试/价格口径下比较 Accuracy、Existence Precision/Recall、Relation/Direction Accuracy、Latency、Input/Output Tokens、Cost。先采真实数据，再决定候选，不实现或调用任何候选。

## 13. 验证与开发部署

测试独立 active/checked、灰色/紫色、checkbox、四筛选/全选/CTA、串行/单篇失败继续/软取消/进度、二级详情与仅两 Tab、全局图/pan/zoom、History 兼容、真实/估算/缺失 usage、阶段计时/pair计数/聚合报告/Git忽略/不写Wiki。运行 preflight/typecheck/test/regression/build。手动清单固定 KnowledgeCuratorValidation/reports/v0.2-phase2a-gui-checklist.md。不重启外部 AI 实验；之前被拒绝的真实文章发送仍不自动执行。

开发只复制 main.js/manifest.json/styles.css 至 /Users/asus/Desktop/knowledge-curator-dev/.obsidian/plugins/knowledge-curator，备份原构建、不触碰 MyWiki。onunload 不 detach，Settings heading 仍 Setting.setHeading、无插件名，description 无 Obsidian，无远程可执行、自更新或运行时安装。

## 14. 实际结果、文件变更、测试与限制

实现已落地：新增 BatchWorkspaceState/BatchAnalysisQueue、全局图和 History 展示模型、逐篇性能 recorder/repository、纯本地报告脚本；控制器保持原 One-click pipeline，服务仅加入观测，未改变 Prompt/Retrieval/Relation 算法。

验证：preflight PASS；typecheck PASS；功能 TEST_TOTAL=393 / TEST_PASS=393，另有 8 项本地文件检查通过；REGRESSION_TOTAL=134 / REGRESSION_PASS=134 / PASS_TO_FAIL=0；build 与插件静态校验 PASS。版本仍 0.1.3。

开发部署：仅 main.js/manifest.json/styles.css，SHA256 与构建一致；备份 /private/tmp/kc-phase2a-dev-backup-20261027。开发 Vault 88 个 Markdown 的部署前后 SHA256 完全一致。

Obsidian 1.14.5 已重开 knowledge-curator-dev 并看到新工作台、默认未分析 84 篇、Checkbox 和批量 CTA、三个独立导航、Card 二级详情。原生 UI 自动化存在 stale AX / noWindowsAvailable / ScreenCaptureKit 错误，其余验收不冒充完成。host 测试验证两 Tab、筛选、全选、取消、图交互与 History，但不能代替完整原生验收。

真实性能样本 0；报告 JSON/Markdown 已生成且 Git ignored，P50/P95=null，成本=null。此前自动审批拒绝过真实文章发送至已配置 DeepSeek 并自动写开发 Wiki，原因是缺少具体内容和目的地授权；本轮未重试该外发动作。真实批处理与性能测量待用户验收/授权，保留清单。

PHASE_2A_IMPLEMENTATION = PARTIAL（代码和离线验证完成，完整原生 GUI 与真实 AI benchmark 尚未验收）
CURRENT_BOTTLENECK = INSUFFICIENT_DATA
JEV_IMPLEMENTED = NO
RULE_CLASSIFIER_IMPLEMENTED = NO
Claim Comparison = EXISTING BASELINE

PRODUCT_CHANGE_DOC = UPDATED
TECH_SELECTION_STATUS = PENDING_BENCHMARK
