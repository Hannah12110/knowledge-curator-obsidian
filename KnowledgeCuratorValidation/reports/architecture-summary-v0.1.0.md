# Knowledge Curator v0.1.0 — Architecture Summary

## Main Pipeline

```text
Source
  ↓
Source Analysis
  ↓
Claim Extraction
  ↓
Wiki-derived Claim Store
  ↓
Claim Retrieval & Comparison
  ↓
Conflict / Freshness Verification
  ↓
Knowledge PR
  ↓
Human Review
  ↓
Write Guard → Wiki
```

Wiki Markdown is the Source of Truth. Candidate Claims do not become accepted knowledge until an approved Knowledge PR changes the Wiki and the target file is re-indexed.

External search is selective: conflicts and user-requested maintenance generate compact queries; the LLM receives only the relevant Claim and ranked, allowlisted evidence.

## Graph Sidecar

```text
Claim Store
  ↓
Sparse Candidate Retrieval
  ↓
Relation Classifier
  ↓
Suggested Claim Graph
  ↓
Human Review Boundary
```

Graph nodes come only from Claim Store. Relations are model suggestions, not verified facts. The Graph Sidecar writes only a local derived JSON store and cannot directly change Wiki Markdown.

## Safety Boundary

- Production Preview: analyze, verify and preview only.
- Test Mode: Accept is limited to an isolated Wiki root.
- Knowledge PR: human decision, stale/hash guards and read-back validation.
- Claim Graph: `HUMAN_IN_THE_LOOP`.
- Autonomous Compression: `BLOCKED_BY_QUALITY_GATE`.
