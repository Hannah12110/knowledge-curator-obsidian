# Phase 7 Final Release Decision

生成日期：2026-10-08  
版本：0.1.0  
结论：`Knowledge Curator MVP = COMPLETE`

## Product Status

| Area | Decision |
|---|---|
| Knowledge Curator MVP | `COMPLETE` |
| Claim Graph | `HUMAN_IN_THE_LOOP` |
| Autonomous Compression | `BLOCKED_BY_QUALITY_GATE` |
| Production Safety | `PASS` |
| Relation Model Quality | `LIMITED` |

## Capability

可发布并演示：

- Source Analysis
- Claim Extraction / Claim Store
- Claim Retrieval v2 / Claim Comparison v2
- Conflict Verification with external evidence
- Knowledge PR / Diff / Accept / Reject
- Freshness Risk / Maintenance Verification
- Claim Graph relation suggestion
- Human relation review and frozen evaluation workflow

## Restricted

以下关系只允许作为模型建议，必须进入 human-in-the-loop：

- `supports`
- `refines`
- `depends_on`
- `contradicts`
- `duplicate`

运行时边状态视为 `SUGGESTED`。人工审核语义可表达 `REVIEWED_ACCEPTED`、`REVIEWED_REJECTED`、`UNCERTAIN`，但 0.1.0 不新增生产态 Relation Review Store。

## Blocked

- automatic compression
- automatic merge
- automatic delete
- relation-driven automatic knowledge rewrite
- Graph relation 直接授权 Knowledge PR replace

状态统一为：`BLOCKED_BY_QUALITY_GATE`。

## Why Compression Is Blocked

Compression Evaluation 被 Release Gate 主动阻断，不是“尚未开发”：

- DeepSeek Flash Relation Accuracy 72.1%（31/43），未达到 80%。
- DeepSeek v4-pro Relation Accuracy 69.8%（30/43），未达到 80%。
- `supports` / `refines` 边界在两个模型上仍不稳定。
- Duplicate False Positive 虽为 0，但冻结真实 duplicate 覆盖不足。
- 模型选择实验结论为 `MODEL_INDEPENDENT_LIMITATION`。

因此 `productionCandidate = null`，`compressionEligible = false`。继续提高自动化权限会把分类误差放大为不可逆知识损失，不符合产品安全边界。

## Final Architecture

```text
Source → Analysis → Claim Extraction → Claim Store → Retrieval
                                               ↓
Conflict Detection → External Verification → Knowledge PR → Human Review → Wiki

Claim Store → Sparse Candidate Retrieval → Relation Classifier
           → AI Relation Suggestion → Human Review Boundary
```

Claim Graph 只写本地派生 JSON，不直接写 Wiki。

## Safety Architecture

| Mechanism | Prevented Failure |
|---|---|
| Markdown source of truth | 派生索引取代真实知识 |
| Production Preview read-only | 在真实知识库误 Accept |
| Test-only writable scope | 写入越界 |
| Human Accept / Reject | AI 直接修改知识 |
| mtime + SHA-256 stale checks | 覆盖用户并发编辑 |
| Before unique match + read-back | 修改错误段落或写入不完整 |
| Evidence URL allowlist | LLM 虚构外部来源 |
| Runtime validation + fail closed | 非法模型输出进入状态机 |
| Frozen dataset / graph snapshot | 评测输入漂移和标签混用 |
| Human ground truth | 模型给自己打分 |
| Release gate | 指标不足仍开放高风险自动化 |
| No auto merge / compression | 关系错误导致知识丢失 |

## Final Metrics

真实冻结输入：184 Claims / 7 Wiki；43/43 Edge Review，13/40 Unrelated Review，0/30 Orphan Review；总人工覆盖 56/113。

| Metric | Flash | v4-pro |
|---|---:|---:|
| Edge Precision | 93.0% (40/43) | 93.0% (40/43) |
| Relation Accuracy | 72.1% (31/43) | 69.8% (30/43) |
| Direction Accuracy | 93.5% (29/31) | 86.7% (26/30) |
| Existence Precision | 93.5% (43/46) | 92.0% (46/50) |
| Existence Recall | 91.5% (43/47) | 97.9% (46/47) |
| Supports Precision | 81.3% (13/16) | 61.9% (13/21) |
| Refines Precision | 75.0% (18/24) | 77.3% (17/22) |
| Duplicate FP | 0 | 0 |
| Sampled Unrelated FN | 4/13 | 1/13 |

没有模型通过全部 autonomous relation gate。

## Known Limitations

1. supports / refines semantic boundary
2. related / unrelated boundary
3. epistemic-strength asymmetry
4. scope mismatch
5. duplicate frozen real-data coverage insufficient
6. orphan evaluation not completed
7. graph relation cannot trigger autonomous knowledge mutation
8. 同一 Claim Store 经 LLM 重跑后 Graph relation 数曾出现 45 → 42 → 43 的运行间波动

## Operational Warning

Phase 7.5 Snapshot 记录 169 个 Markdown；本次 Closeout 开始时 Vault 已有 220 个 Markdown。在本轮执行期间又观察到外部并发整理，Final E2E 的稳定窗口为 182 → 182、内容变化 0；whole-turn 对比为 27 个 byte-identical move、67 个 unmatched removal、29 个 unmatched addition、6 个同路径内容变化。Closeout 没有执行 Vault 写命令，也未恢复这些外部变化。Dataset、annotations、Claim Store、实时 Graph 与冻结 Graph 哈希全部保持不变。

现有插件设置仍引用已移动的 `KnowledgeCuratorPhase1Test/...` 路径。为避免越权，本阶段不修改配置、不恢复文件、不重建 Claim Store。再次演示写入前，应由用户手工核对 Folder Settings 与 Test Mode 固定写入范围。

## Release Recommendation

发布 0.1.0 作为 human-in-the-loop 知识治理 MVP。可演示 Claim Graph 建议与人工审核方法，但不得宣称其为 Ground Truth Graph，也不得开放 autonomous compression、merge、delete 或 graph-driven rewrite。
