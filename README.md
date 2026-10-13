# Knowledge Curator

## Overview

Knowledge Curator 是一个面向 Obsidian 的 Claim-level knowledge governance 插件。它不是“AI 总结器”，而是在知识进入 Wiki 前完成分析、比较、验证和人工审核，并在进入知识库后持续维护其时效性。

核心产品转变：

```text
Document-level knowledge management
→ Claim-level knowledge governance
```

当前版本：`0.1.1`
MVP 状态：`COMPLETE`  
Claim Graph：`HUMAN_IN_THE_LOOP`  
自主知识压缩：`BLOCKED_BY_QUALITY_GATE`

## Problem

持续向个人知识库导入文章会造成重复知识、隐性冲突、过时事实、来源质量不一，以及“AI 直接重写 Wiki”带来的不可控风险。文档级相似度也无法稳定回答：一句新表述究竟是新增、补充、支持，还是挑战已有知识。

## Product Insight

Knowledge Curator 将治理单元从 Document 下沉到 Claim：

```text
Source
  → Source Analysis
  → Claim Extraction
  → Claim Retrieval & Comparison
  → Conflict Verification
  → Knowledge PR
  → Human Review
  → Safe Wiki Update
```

Wiki Markdown 始终是 Source of Truth。Claim Store、Maintenance Store 与 Claim Graph 都是可删除、可重建的本地派生状态。

## Core Workflow

1. 将来源放入 Inbox。
2. 本地召回相关 Wiki / Raw 片段。
3. LLM 抽取 Candidate Claims，并与 Top K Existing Claims 比较。
4. 聚合出 ADD / REINFORCE / REFINE / CHALLENGE。
5. 只有冲突或用户主动维护时才调用 Tavily 获取外部证据。
6. 生成最小化 Knowledge PR；用户查看 Before / After Diff。
7. 只有 Test Mode 下的显式 Accept 才能通过 Write Guard 写入测试 Wiki。

## Architecture

```text
Source → Analysis → Claim Extraction → Claim Store → Retrieval
                                               ↓
Conflict Detection → External Verification → Knowledge PR → Human Review → Wiki

Claim Store → Sparse Candidate Retrieval → Relation Classifier
           → AI Relation Suggestions → Human Review Boundary
```

Claim Graph 不直接写知识库，也不能触发自动合并、删除或改写。

## Claim Model

- `ClaimRecord` 保存原子陈述、类型、限定条件、置信度和最小 provenance。
- Claim ID 基于规范化陈述、来源路径与有效限定条件稳定生成。
- Claim Store 只从 Wiki 派生；Raw 中出现的陈述不会自动成为已接受知识。
- Candidate Claim 只有在 Knowledge PR 被接受并重新索引目标 Wiki 后，才可能成为 Existing Claim。
- Retrieval v2 使用中文 n-gram、英文规范化、缩写、双语 alias、短语、topic、type、qualifier、negation、数字和版本信号，不使用 Vector DB。

## Knowledge PR

关系到 PR 的映射保持保守：

- ADD → `add`
- REFINE → `refine`，只补未覆盖信息
- REINFORCE → 默认不增加重复正文
- CHALLENGE → 必须先验证
- SUPERSEDE → 只有 Phase 4 外部验证授权后才允许 `replace`

所有写入仍经过目标路径白名单、mtime/hash stale 检查、唯一匹配、写后回读、History 与回滚保护。

## Conflict Verification

外部搜索只在冲突验证或用户主动维护 Claim 时触发。Tavily 只收到精简 Search Query；DeepSeek 只收到当前 Claim、有限上下文与筛选后的证据。Evidence URL 必须来自本次 Search Result allowlist，低质量来源不能单独授权替换旧知识。

## Freshness & Maintenance

Freshness Risk 在本地以 deterministic 规则评估，只表示“值得优先检查”，不等于 Claim 已经过时。只有用户主动验证，系统才调用 Tavily 与 LLM；`still_valid` 不生成正文 PR，`needs_refinement` 只允许 refine，`stale` 也必须经人工 Accept 才能 replace。

## Claim Graph

Claim Graph 的正式定位是：**AI-assisted Relation Suggestion Layer**，不是 Ground Truth Knowledge Graph。

```text
Claim A → Model-suggested relation → Claim B → Human Review
```

运行时存储的边是 `SUGGESTED`。人工评测语义可区分 `REVIEWED_ACCEPTED`、`REVIEWED_REJECTED` 与 `UNCERTAIN`，但 0.1.0 不新增复杂的生产态 Relation Review Store。UI 明确显示“AI 建议关系”，不把模型输出描述为已验证事实。

真实人工审核表明 Graph 能发现大量有效边，但 relation taxonomy 边界仍不足以授权自主知识变更。自主 Compression 因质量门禁被有意关闭，而不是尚未实现。

## Evaluation

真实冻结基线：184 Claims / 7 Wiki，43 条 Persisted Edge 全量人工审核；Unrelated 审核 13/40；Orphan 0/30。

| 指标 | DeepSeek Flash | DeepSeek v4-pro |
|---|---:|---:|
| Edge Precision | 93.0% (40/43) | 93.0% (40/43) |
| Relation Accuracy | 72.1% (31/43) | 69.8% (30/43) |
| Direction Accuracy | 93.5% (29/31) | 86.7% (26/30) |
| Existence Precision | 93.5% (43/46) | 92.0% (46/50) |
| Existence Recall | 91.5% (43/47) | 97.9% (46/47) |
| Supports Precision | 81.3% (13/16) | 61.9% (13/21) |
| Refines Precision | 75.0% (18/24) | 77.3% (17/22) |
| Duplicate False Positive | 0 | 0 |
| Sampled Unrelated FN | 4/13 | 1/13 |

两个模型都没有通过全部 autonomous relation gate，最终结论为 `MODEL_INDEPENDENT_LIMITATION`，`productionCandidate = null`，`compressionEligible = false`。这些数据来自相同冻结输入，但 13 条 Unrelated 是小样本观察，不能解释为全局 Recall；Orphan 尚未完成人工评测。

## Safety

- Markdown / Vault 是唯一知识真相来源。
- Production Preview 可以分析、验证和预览 PR，但不能 Accept。
- Test Mode 只允许写入固定隔离范围。
- Knowledge PR 必须人工 Accept / Reject。
- stale mtime、SHA-256 与目标内容唯一匹配阻止覆盖并发修改。
- Search evidence allowlist 阻止模型虚构 URL。
- Runtime validation、bounded retry 与 fail-closed 阻止非法输出被默认为 ADD、STALE 或 relation。
- Frozen Dataset / Graph Snapshot / fingerprint 防止评测数据混用。
- Claim Graph 只能提出建议；自主 merge、delete、rewrite 与 compression 均被关闭。

## Privacy & Data Flow

```text
Vault → Local Retrieval → Selected Context Only → LLM Provider
Conflict / Freshness Claim → Refined Search Query Only → Tavily
```

Knowledge Curator 只在用户主动执行对应功能时联网：

- OpenAI-compatible LLM Provider：用于 Source analysis、Claim extraction、Claim comparison、Knowledge PR generation、verification 和 relation suggestion。根据当前操作，可能发送当前 Source 的相关文本、召回的 Wiki / Raw 片段、Top K Claims、必要 provenance、目标 Wiki 的局部上下文、筛选后的外部证据或候选 Claim relation pairs。
- Tavily：仅在用户主动执行 Conflict Verification 或 Freshness Verification 时调用，只接收为当前 Claim 精简生成的 Search Query。

不会默认上传整个 Vault、整个 Claim Store、完整 History 或无关笔记。API Key 由用户自行提供，通过 Obsidian `saveData()` 保存在当前 Vault 的插件 `data.json` 中，只发送给对应 Provider，不写入报告或 History。Knowledge Curator 没有自有后端，也不包含 client-side telemetry、server-side telemetry、analytics 或 crash reporting。

## Installation

Community Directory submission is pending. 收录后可在 Obsidian 中依次打开：

```text
Settings → Community plugins → Browse → Knowledge Curator → Install → Enable
```

在正式收录前，测试人员可以将当前 release 的 `main.js`、`manifest.json` 和 `styles.css` 放入：

```text
<Vault>/.obsidian/plugins/knowledge-curator/
```

然后在 Community plugins 中启用 Knowledge Curator。

## Configuration

首次使用需要在插件设置中配置：

- LLM Base URL：兼容 OpenAI Chat Completions API 的服务地址。
- LLM Model：对应 Provider 的模型标识。
- LLM API Key：用户自行申请并保存在当前 Vault 的插件数据中。
- Tavily API Key：仅 Conflict / Freshness Verification 需要。
- 文件夹路径：Inbox、Wiki 与一个或多个 Raw Folder。
- Test Mode：只有固定隔离测试 Wiki 可以通过显式 Accept 写入。
- Production Preview：可以分析、验证和预览 Knowledge PR，但不能 Accept 或写入正式 Wiki。

API Key 未配置时，依赖该 Provider 的操作会显示可重试错误，不会静默执行或修改 Markdown。

## Desktop Only

`isDesktopOnly` 设置为 `true`。插件依赖 Obsidian 桌面端的本地 Vault adapter、派生状态存储及文件系统相关行为，当前不声明移动端兼容性。

## License

Knowledge Curator is distributed under a [proprietary license](LICENSE). The source code is publicly visible for transparency and Community review, but public visibility does not make the project open source or grant permission to modify or redistribute it.

## Local Development

1. 安装构建后的 `main.js`、`manifest.json` 和 `styles.css`。
2. 在设置中配置 Inbox、Wiki、Raw 路径及运行模式。
3. 配置 OpenAI-compatible LLM；冲突验证可选配 Tavily。
4. 将文章放入 Inbox，点击“分析”。
5. 对 CHALLENGE 点击“验证冲突”。
6. 生成 Knowledge PR 并检查 Diff。
7. 仅在 Test Mode 对隔离测试 Wiki 执行 Accept。
8. Claim Graph 页面中的所有关系均视为 AI 建议，需人工复核。

开发验证：

```bash
npm run preflight:local-files
npm run typecheck
npm test
npm run regression
npm run build
npm run verify:final-closeout -- --vault /path/to/vault
```

## Known Limitations

1. `supports` / `refines` 语义边界仍不稳定。
2. `related` / `unrelated` 边界仍存在 false negative / false positive。
3. epistemic-strength asymmetry 容易被误解为细化或冲突。
4. scope mismatch 仍可能造成错误关系。
5. Duplicate 的真实冻结样本覆盖不足，不能外推生产准确率。
6. Orphan Evaluation 尚未完成。
7. Relation suggestion 不能作为 autonomous knowledge mutation trigger。
8. Retrieval 仍主要是 lexical / alias / heuristic，不使用 embedding。
9. 搜索只支持 Tavily，且未抓取完整网页正文。
10. Production Write 未开放。

## Current Status

| Area | Status |
|---|---|
| Knowledge Curator MVP | `COMPLETE` |
| Claim Graph | `HUMAN_IN_THE_LOOP` |
| Autonomous Compression | `BLOCKED_BY_QUALITY_GATE` |
| Production Safety | `PASS` |
| Relation Model Quality | `LIMITED` |

最终发布决策见 [phase7-final-release-decision.md](KnowledgeCuratorValidation/reports/phase7-final-release-decision.md)，发布核对见 [FINAL_RELEASE_CHECKLIST.md](KnowledgeCuratorValidation/FINAL_RELEASE_CHECKLIST.md)。

Release package documentation:

- [Release Notes](RELEASE_NOTES_v0.1.0.md)
- [Changelog](CHANGELOG.md)
- [Architecture Summary](KnowledgeCuratorValidation/reports/architecture-summary-v0.1.0.md)
- [Demo Script](KnowledgeCuratorValidation/reports/demo-script-v0.1.0.md)
