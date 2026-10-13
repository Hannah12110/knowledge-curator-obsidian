# Changelog

All notable changes to Knowledge Curator are documented here.

## 0.1.1

### Community Release Preparation

- Add the proprietary license and public-source licensing disclosure.
- Add Community installation, configuration, network, privacy, safety and desktop-only documentation.
- Align package, manifest and compatibility metadata for the Community candidate.

### Safety

- Keep Production Preview read-only and Test Mode restricted by the existing Write Guard.
- Keep autonomous merge, delete, relation-driven rewrite and compression disabled.

## 0.1.0

### Added

- Source Analysis with document and Claim-level retrieval.
- Wiki-derived Claim Store and incremental re-indexing.
- ADD / REINFORCE / REFINE / CHALLENGE comparison.
- Conflict verification with Tavily search, source ranking and external evidence.
- Knowledge PR, Diff, Accept / Reject and History.
- Freshness Risk, Maintenance Queue and selective verification.
- AI-assisted Claim Graph relation suggestions and frozen human evaluation workflow.

### Safety

- Markdown remains the Source of Truth.
- Production Preview is read-only; Test Mode is scope restricted.
- Write Guard, mtime/hash stale validation, unique-match replacement and read-back checks.
- Evidence URL allowlist, runtime schema validation, bounded retry and fail-closed behavior.
- No automatic merge, delete, relation-driven rewrite or autonomous compression.

### Evaluation

- 184-Claim / 43-Edge frozen real-Graph evaluation.
- 43/43 persisted edges received human review; 13/40 unrelated samples were reviewed.
- DeepSeek Flash and v4-pro model-choice replay ended in `MODEL_INDEPENDENT_LIMITATION`.
- Synthetic regression and automated safety suites cover the full MVP workflow.

### Known Limitations

- supports/refines and related/unrelated boundaries remain imperfect.
- Epistemic asymmetry and scope mismatch remain challenging.
- Duplicate real-world coverage is insufficient and Orphan evaluation is incomplete.
- Claim Graph is human-in-the-loop and cannot authorize autonomous knowledge mutation.
