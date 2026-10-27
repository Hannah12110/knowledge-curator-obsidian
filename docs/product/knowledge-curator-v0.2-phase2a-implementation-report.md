# Knowledge Curator V0.2 Phase 2A — Batch Analysis & Performance Report

## 1. Product Change Document

PRODUCT_CHANGE_DOC = UPDATED。见同目录 knowledge-curator-v0.2-phase2a-product-change.md，包含修改前审计与实现后结果。

## 2. Phase 1 Baseline

基于未合并 Phase 1 分支最新提交 1a7ef1fdba8410cbfd9a905869b87e48fb94f84c 创建；原单篇 Orchestrator 保留。Phase 1 完整真实 AI 验收此前未完成，不升级为已验收事实。

## 3. Article Selection Model

activeArticleId 与 selectedArticleIds 独立；多视图的详情选择各自独立，批量运行不会抢切当前详情。

## 4. Selected State UI

浅色普通文章白色、active 灰色、checked 紫色标记+Checkbox。host 测试覆盖独立样式；原生仅部分验证。

## 5. Filters

全部 / 未分析 / 已分析 / 分析失败，默认未分析；状态来源复用原控制器。

## 6. Select All

仅当前筛选，支持 indeterminate；其他筛选的隐藏勾选保留并提示，当前批次只使用当前筛选的勾选。

## 7. Batch CTA

分析所选 N 篇 / 分析全部未分析文章；无目标禁用。没有 active article 隐式回退。

## 8. Batch Job Model

BatchAnalysisJob 与 tasks 明确 ID/时间/状态/计数/当前文章/metrics，串行并冻结任务列表，单篇失败继续。

## 9. Batch Progress UI

显示完成/处理中/等待/失败/取消、当前文章及阶段。取消后续任务：等当前文章结束再停止；不宣称中断当前请求。

## 10. Article Detail Secondary Page

工作台与详情分离；返回列表保留筛选勾选。原生 Card → 未分析详情已观察到。

## 11. Analysis Dimensions

质量、冲突、重复、时效性、新增/差异可展开；复用原 SourceAnalysis/Comparison/Verification/Freshness。

## 12. Knowledge Point UI

复用原 point 映射和来源；新增/补充展示基于现有 action/coverage，纯重复不当新增。

## 13. Article Relation Tab Removal

文章详情仅文章分析/知识点两 Tab；局部关系 Tab 已从页面移除。无有效结果时展示空态。

## 14. Global Knowledge Relation Mind Map

独立导航+命令，读取整个 Graph Store；按已有 topic/Wiki 分组；pan/zoom/reset/expand/collapse/node metadata 已实现并通过 host 测试，完整原生验收待完成。

## 15. Change Log

复用原 .knowledge-agent/history，单独列表/片段详情；旧可选字段允许缺失，坏记录隔离；无假撤销。

## 16. Performance Instrumentation

逐篇字符/token估算、claims、pairs、request usage、各阶段/总耗时、provider/model、默认null成本；仅本地 ignored validation 保存。普通 UI 不展示。

## 17. Claim Comparison Metrics

candidate = 各候选召回保留 match 数之和；dedup = candidateId+existingId；LLM unique sent pairs 与含重试 attempts 分开；cache/原有fast path不算 LLM 对。无match候选另记请求候选数。

## 18. Token Usage

合法 Provider prompt_tokens/completion_tokens 记 actual；缺 usage 用明确启发式 estimated；失败未返回输出记 unavailable。记录实际重试，未知值为 null。

## 19. Latency Results

真实样本=0，Comparison/Total P50/P95=null；离线时钟与 synthetic pipeline 测试只验证计时机制，不能用作 DeepSeek 延迟结论。

## 20. Performance Report Paths

KnowledgeCuratorValidation/reports/claim-comparison-performance.json 与 .md 已生成；脚本 npm run benchmark:claim-comparison-performance；两文件 Git ignored，无真实数据外传。

## 21. Current Bottleneck

CURRENT_BOTTLENECK = INSUFFICIENT_DATA。没有真实样本，不判断 extraction/retrieval/pair explosion/comparison/freshness/relation/write 谁是瓶颈。

## 22. Jev / Rules Status

JEV_IMPLEMENTED = NO
RULE_CLASSIFIER_IMPLEMENTED = NO
TECH_SELECTION_STATUS = PENDING_BENCHMARK
Claim Comparison = EXISTING BASELINE

## 23. Backend Changes

沿用 DeepSeek/model/Prompt/Retrieval/Relation 枚举、比较与 Wiki writer；新增队列调度和观测器、History read API。无 Jev / rules classifier。

## 24. Files Changed

- .gitignore
- package.json
- scripts/run-tests.mjs
- src/controllers/curator-controller.ts
- src/main.ts
- src/product/workflow-presenter.ts
- src/services/analysis-service.ts
- src/services/claim-comparison-service.ts
- src/services/history-service.ts
- src/services/knowledge-file-store.ts
- src/services/llm-service.ts
- src/views/curator-view.ts
- styles.css
- tests/comparison-execution.test.ts
- tests/obsidian-ui-stub.ts
- tests/one-click-services-integration.test.ts
- tests/workflow-view.test.ts
- KnowledgeCuratorValidation/reports/v0.2-phase2a-gui-checklist.md
- docs/product/knowledge-curator-v0.2-phase2a-product-change.md
- scripts/report-claim-comparison-performance.mjs
- src/product/batch-analysis.ts
- src/product/global-workspace.ts
- src/services/performance-metrics.ts
- src/services/performance-repository.ts
- tests/batch-analysis.test.ts
- tests/batch-view.test.ts
- tests/global-workspace.test.ts
- tests/performance-metrics.test.ts

## 25. Tests

TEST_TOTAL = 393
TEST_PASS = 393
TEST_FAIL = 0
另有 8 项 local-file tests 通过；preflight/typecheck PASS。

## 26. Regression

REGRESSION_TOTAL = 134
REGRESSION_PASS = 134
PASS_TO_FAIL = 0
未更新 regression baseline。

## 27. Build

npm run build PASS，plugin verification PASS；main.js 514619 bytes，SHA256 c3d58e93022dfacc502fc56eadf23d93e652d46cb96a62144b5de7ee552967e8。package/manifest 均 0.1.3。仅3文件部署dev，88份Markdown哈希一致。

## 28. GUI Checklist

见 KnowledgeCuratorValidation/reports/v0.2-phase2a-gui-checklist.md，区分原生与 host 验证。新工作台加载/默认筛选/详情已观察，真实批处理/完整图/History 实机验收未完成。

## 29. Feature Branch

feature/v0.2-batch-analysis。未合并 main、未 tag、未 bump、未 release。

## 30. Commit

提交信息：feat: add batch analysis workspace and performance metrics。具体 SHA 由最终答复与 git log -1 提供，避免文档自引用。

## 31. Known Limitations

队列内存态，不跨重启恢复；取消仅停止后续；全局分组来自已有字段而非AI聚类；History是原变更片段而非完整Undo；价格需明确配置；原生自动化 AX/屏幕捕获不稳定。真实AI发送此前自动审批拒绝（具体私有文章/相关知识→配置DeepSeek及自动写dev Wiki授权不足），未通过CLI绕过。

## 32. NEXT_PHASE_RECOMMENDATION

先由用户检查批量 UX，并明确授权有限真实样本运行；积累 baseline 原始 latency/token/pair 数据，区分冷/热缓存后再决定 Phase 2B 候选。2B 仅写设计，本轮不执行。

PHASE_2A_IMPLEMENTATION = PARTIAL

代码和离线验证完成；完整原生 GUI 与真实性能采样尚待验收。STOP：不进入 Phase 2B。
