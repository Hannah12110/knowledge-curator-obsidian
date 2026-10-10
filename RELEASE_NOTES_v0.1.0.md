# Knowledge Curator v0.1.0

## What It Is

Claim-level knowledge governance for Obsidian.

Knowledge Curator 的核心不是 AI 总结，而是在知识进入 Wiki 前完成 analysis、comparison、verification 与 review，并对已接受知识进行可解释的 maintenance。

## Core Workflow

```text
Source → Claim → Retrieval → Verification
       → Knowledge PR → Human Review → Safe Wiki Update
```

## Key Capabilities

- Source Analysis
- Claim Extraction and Wiki-derived Claim Store
- Claim Retrieval v2 and Claim Comparison v2
- ADD / REINFORCE / REFINE / CHALLENGE
- Conflict Verification with allowlisted External Evidence
- Knowledge PR with Before / After Diff
- Human Accept / Reject and History
- Freshness Risk and selective Maintenance Verification
- AI-assisted Claim Graph relation suggestions

## Safety

AI relation suggestion is not ground truth.

- Markdown remains the Source of Truth.
- Production Preview is read-only.
- Test Mode writes only to an isolated scope.
- Knowledge changes require Human Review.
- stale mtime/hash checks prevent overwriting concurrent edits.
- runtime validation and fail-closed behavior prevent malformed model output from becoming knowledge.
- no automatic merge, delete, rewrite, or autonomous compression.

## Evaluation

Real frozen evaluation input: 184 Claims / 7 Wiki; Edge Review 43/43, Unrelated Review 13/40, Orphan Review 0/30.

| Metric | DeepSeek Flash | DeepSeek v4-pro |
|---|---:|---:|
| Edge Precision | 93.0% (40/43) | 93.0% (40/43) |
| Relation Accuracy | 72.1% (31/43) | 69.8% (30/43) |
| Direction Accuracy | 93.5% (29/31) | 86.7% (26/30) |
| Existence Precision | 93.5% (43/46) | 92.0% (46/50) |
| Existence Recall | 91.5% (43/47) | 97.9% (46/47) |
| Supports Precision | 81.3% (13/16) | 61.9% (13/21) |
| Refines Precision | 75.0% (18/24) | 77.3% (17/22) |
| Duplicate False Positive | 0 | 0 |
| Sampled Unrelated False Negative | 4/13 | 1/13 |

Neither model passed every autonomous relation gate. The final experiment result is `MODEL_INDEPENDENT_LIMITATION`; no production relation model was selected.

## Known Limitations

- supports / refines semantic boundary remains unstable.
- related / unrelated classification still has errors.
- epistemic-strength asymmetry and scope mismatch remain difficult.
- frozen real-world duplicate coverage is insufficient for autonomous compression.
- Orphan evaluation is incomplete.
- Claim Graph relations cannot trigger autonomous knowledge mutation.

## Release Decision

- Knowledge Curator MVP: `COMPLETE`
- Claim Graph: `HUMAN_IN_THE_LOOP`
- Autonomous Compression: `BLOCKED_BY_QUALITY_GATE`
- Production Safety: `PASS`
- Relation Model Quality: `LIMITED`
