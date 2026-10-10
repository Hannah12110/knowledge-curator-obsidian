# Knowledge Curator — AI Product Portfolio Summary

## 1. Problem

个人知识库长期积累后，问题不再是“有没有内容”，而是内容是否重复、冲突、过时、可信，以及新文章是否真的贡献了新知识。传统笔记工具缺少持续治理机制；直接让 LLM 重写 Wiki 又会把模型误差变成不可逆的数据损失。

## 2. Product Insight

我把问题从 document management 重新定义为 claim-level knowledge governance：文档只是来源，Claim 才是可以比较、验证、维护和演化的最小知识单元。

## 3. Solution

```text
Source → Claim Extraction → Claim Retrieval / Comparison
       → Conflict Verification → Knowledge PR → Human Review
       → Wiki-derived Claim Store → AI Relation Suggestions
```

产品可识别 ADD / REINFORCE / REFINE / CHALLENGE；冲突才触发外部搜索；所有正文变更以 Knowledge PR 呈现，用户查看 Diff 后 Accept / Reject。

## 4. Key Product Decisions

- **Markdown as Source of Truth**：Claim Store、Graph 和 Maintenance Store 都是可重建派生索引。
- **Claim as atomic knowledge unit**：避免“换一种说法就被判成新增”的 False New。
- **Conflict-only external verification**：Tavily 只在争议或用户主动维护时使用，控制成本与隐私面。
- **Knowledge PR instead of direct rewrite**：AI 提建议，人决定，写入经过 stale 与 scope guard。
- **Human-in-the-loop relation review**：Claim Graph 是 AI 建议层，不是知识真相。
- **Release Gate blocks unsafe automation**：模型关系分类未达门槛，因此主动关闭 autonomous compression。
- **Model / cost / latency trade-off**：Comparison Cache、保守 Fast Path、动态 Batch 和并发上限减少重复调用；对 Graph 则宁可保留人工审核，也不以更高成本换取未经证明的自动写权限。

## 5. Evaluation

项目不是只看单元测试，而是冻结真实 Claim Graph，建立 Human Ground Truth，并把“评测流程成功”和“模型质量达标”分开。

- 184 Claims / 7 Wiki
- 43/43 Persisted Edge 全量人工审核
- 13/40 Unrelated 分层样本已审核
- DeepSeek Flash：Edge Precision 93.0%，Relation Accuracy 72.1%，Direction Accuracy 93.5%
- DeepSeek v4-pro：Edge Precision 93.0%，Relation Accuracy 69.8%，Direction Accuracy 86.7%
- 两个模型 Duplicate FP 均为 0，但真实 Duplicate 覆盖不足
- 最终 `productionCandidate = null`，`compressionEligible = false`

百分比均伴随样本量；Unrelated 是 small-N observational audit，Orphan 尚未评估，不被包装成全局 Recall。

## 6. Failure & Iteration

Relation Classifier 经历了 Human Audit → Error Taxonomy → Prompt Calibration → Decision Architecture → Model Choice Experiment。Flash 与 v4-pro 在不同子指标上各有优势，但都持续卡在 supports/refines、related/unrelated、epistemic asymmetry 和 scope boundary。

最终结论是 `MODEL_INDEPENDENT_LIMITATION`：继续堆 Prompt 或换模型无法证明自主关系写入安全。这个结论改变了产品边界——Graph 保留为可解释的建议和人工审核入口，Compression Evaluation 被 Release Gate 主动阻断。

这不是“模型没调好”的开发遗留，而是基于真实用户数据做出的 Go / No-Go 决策。

## 7. Final Product Boundary

AI 可以：

- 分析来源、提取和比较 Claim
- 检索证据、生成可追溯验证结论
- 提议最小 Wiki 更新
- 提示 Claim 间可能的关系

AI 不可以：

- 绕过 Human Review 修改 Wiki
- 根据 Graph 自动 merge / delete Claim
- 把 model-suggested relation 当成 verified truth
- 在关系质量门槛不足时开放 autonomous compression

最终状态：MVP COMPLETE，Claim Graph HUMAN_IN_THE_LOOP，Production Safety PASS，Relation Model Quality LIMITED。
