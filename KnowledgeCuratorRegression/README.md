# Knowledge Curator Regression Dataset

This synthetic, non-private dataset is isolated from production knowledge folders. It contains 80 deterministic cases: 12 document/workflow cases, 8 Phase 5 relation cases, 10 Phase 5.1 retrieval cases, 12 Phase 5.2 comparison cases, 20 frozen Harness Candidates, and 18 frozen Agent Memory Candidates.

`claim-comparison/` fixes the Candidate Claim and Retrieval v2 Top K. This makes Comparison v1/v2 A/B independent of Candidate Extraction randomness. Human labels may exclude true retrieval misses and unclear cases from comparison-only error denominators; those cases remain visible in the audit totals.

`expected/` contains flexible labels. `outputs/` contains checked-in product contract snapshots used by the offline release gate. The runner reports sample sizes, compares all prior PASS cases and Phase 4.5/5/5.1 metrics with the baseline, never accepts a Knowledge PR, and never writes to an Obsidian Vault.
