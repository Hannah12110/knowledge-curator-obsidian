# Knowledge Curator 0.1.0 Release Checklist

## Build

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run regression`
- [ ] `npm run build`
- [ ] Bundle verification reports only the Obsidian runtime external

## Plugin

- [ ] Deploy into a disposable Vault
- [ ] Reload plugin without runtime errors
- [ ] Open Sidebar from Ribbon and Command Palette
- [ ] Open Settings and verify saved values after restart
- [ ] Verify an open Sidebar restores after reload

## Analysis

- [ ] Analyze a normal source
- [ ] Check a high-duplicate case
- [ ] Check an obvious new-knowledge case
- [ ] Trigger a safe provider error and retry
- [ ] Confirm only configured Inbox / Wiki / Raw folders are read

## Claim Store and Claim Mode

- [ ] Build Claim Store and verify progress, indexed Wiki, Claim count, and failed files
- [ ] Run incremental build and confirm unchanged Wiki files are cache hits
- [ ] Change one test Wiki and confirm only that file is re-indexed
- [ ] Remove a disposable test Wiki and confirm its Claims are cleaned up
- [ ] Verify corrupt Store does not prevent Sidebar opening and can be rebuilt
- [ ] Check exact/paraphrase duplicate → REINFORCE, genuine new fact → ADD
- [ ] Check scope refinement → REFINE and qualifier/numerical conflict → CHALLENGE
- [ ] Confirm only Candidate Claim + Top K Existing Claims reach comparison
- [ ] Confirm Legacy Document Mode remains usable
- [ ] Confirm old cache invalidates when mode, Top K, or Claim Store revision changes
- [ ] Confirm Accept re-indexes final Wiki and Reject leaves Claim Store unchanged

## Claim Retrieval v2

- [ ] Check Chinese bigram/trigram and technical phrase preservation
- [ ] Check Chinese ↔ English alias and acronym retrieval
- [ ] Check qualifier and negation conflicts remain retrievable
- [ ] Check numeric/model/version tokens preserve precision
- [ ] Compare retrieval v1/v2 in the regression report
- [ ] Review `harness-claim-audit.md` instead of treating lower ADD count as the goal
- [ ] Run `npm run benchmark:claim-retrieval` and review 184/1k/5k/10k timings
- [ ] Confirm Analysis Cache invalidates when retrieval version changes

## Claim Comparison v2

- [ ] Run the fixed Candidate v1/v2 A/B without re-running extraction
- [ ] Check equivalent and existing-broader → full → REINFORCE
- [ ] Check candidate-broader and multi-Claim partial → REFINE
- [ ] Check multi-Claim full coverage → REINFORCE
- [ ] Check qualifier, negation, and numeric conflict → CHALLENGE
- [ ] Check genuine new knowledge → none → ADD
- [ ] Confirm inconsistent Coverage/Relation is rejected and invalid Coverage retries once
- [ ] Confirm a failed Coverage request never silently falls back to ADD
- [ ] Review False ADD Comparison Error and False REINFORCE Rate together
- [ ] Confirm Analysis Cache invalidates when comparison version changes
- [ ] Run real Harness, Agent Memory, and conflict-fixture analyses

## Comparison execution v1

- [ ] Run `npm run benchmark:comparison` and compare cold vs warm calls and latency
- [ ] Confirm unchanged Candidates restore from Comparison Cache with zero provider calls
- [ ] Change one fixed Candidate and confirm only that Candidate misses cache
- [ ] Review controlled Fast Path precision; any uncertain or multi-Claim case must fall back to LLM
- [ ] Confirm numeric, negation, and qualifier conflicts remain `CHALLENGE`
- [ ] Confirm dynamic packing never exceeds six Candidates per batch
- [ ] Confirm scheduler concurrency is capped at two and merge order is stable
- [ ] Simulate 429/timeout and confirm successful batches remain cached
- [ ] Simulate a schema-invalid multi-Candidate response and confirm only that failed batch is isolated; a failing single Candidate must remain fail-closed
- [ ] Clear Comparison Cache from Settings and confirm no Markdown or Claim Store change

## Verification

- [ ] Verify a real conflict with Tavily
- [ ] Review source ranking and evidence URL allowlist
- [ ] Confirm REFINE behavior
- [ ] Confirm UNRESOLVED behavior
- [ ] Confirm no-conflict articles do not call search

## Freshness and maintenance

- [ ] Run `npm run benchmark:freshness` and confirm the local scan makes zero network calls
- [ ] Check a stable definition remains Low risk despite an old source date
- [ ] Check current API/model capability, pricing, benchmark, and quantitative Claims rank High/Critical
- [ ] Check historical and explicit version scope prevents false stale decisions
- [ ] Open 知识维护 and verify severity sorting plus verified/unverified filters
- [ ] Confirm queue rendering and risk scan do not call Tavily
- [ ] Verify one selected Claim with Tavily + DeepSeek and inspect allowlisted evidence
- [ ] Confirm still_valid and insufficient_evidence create no body PR
- [ ] Confirm needs_refinement permits refine only and stale requires Tier 0/1 evidence before replace
- [ ] Confirm disputed cannot produce replace
- [ ] Reject a Maintenance PR and verify Wiki plus Claim Store remain unchanged
- [ ] Accept a Maintenance PR in Test Mode and verify only the target Wiki is re-indexed
- [ ] Reload and confirm queue, verification, PR state, and History persist

## Knowledge PR

- [ ] Generate and review a draft
- [ ] Reject and verify target hash unchanged
- [ ] Accept only in Test Mode and verify target hash changed as expected
- [ ] Update verification and confirm old draft becomes stale
- [ ] Confirm accepted / rejected History persists after reload

## Claim Graph and evolution

- [ ] Build Claim Graph only after Claim Store is ready
- [ ] Confirm build shows bounded progress and writes only `.knowledge-agent/claim-graph/store.json`
- [ ] Review duplicate / supports / refines / contradicts / depends-on relation cards
- [ ] Confirm relation evidence references current Claim IDs and Vault-relative Wiki paths
- [ ] Verify a contradict edge through the existing Phase 4 Tavily + DeepSeek flow
- [ ] Confirm contradiction verification does not directly change Wiki Markdown
- [ ] Review Claim / Relation / Conflict / Duplicate / Orphan health counts
- [ ] Review Knowledge Compression Preview and confirm it has no Accept/write action
- [ ] Change or re-index one test Wiki and confirm the Graph becomes stale
- [ ] Rebuild Graph and confirm reload persistence
- [ ] Run `npm run benchmark:claim-graph` and confirm candidates remain far below all-pairs

## Mode boundary

- [ ] Sidebar clearly displays Test Mode
- [ ] Production Preview clearly displays read-only mode
- [ ] Production Preview Accept button is disabled
- [ ] Write service rejects Production Preview even if called directly

## Privacy and maintenance

- [ ] API keys are password inputs and absent from logs/reports/History
- [ ] Cache clear actions require confirmation
- [ ] Cache clear actions do not modify Markdown
- [ ] History count works and no prominent destructive action is shown

## Safety

- [ ] Markdown SHA-256 snapshot captured before verification
- [ ] Changed outside test scope: 0
- [ ] Deleted: 0
- [ ] Moved: 0
- [ ] No unwanted Inbox or Raw writes
- [ ] Claim Store writes only `.knowledge-agent/claim-store/store.json`
- [ ] Maintenance Store writes only `.knowledge-agent/maintenance/maintenance-store.json`
- [ ] Risk Scan / Verification / Draft / Reject change zero Markdown files

## Phase 7.5 Real Vault Validation — Step 1

- [ ] Run `npm run benchmark:vault -- --vault /absolute/path/to/vault`
- [ ] Confirm Snapshot contains only paths, SHA-256, and sizes—not Markdown content
- [ ] Confirm Wiki / Raw / Inbox counts match current Settings with strict folder boundaries
- [ ] Confirm Baseline references the generated `vaultSnapshotId`
- [ ] Confirm a missing Claim Graph reports `not_built` instead of invented relation metrics
- [ ] Confirm 1000 Markdown Snapshot is below 5 seconds
- [ ] Confirm 10000 Claims Baseline is below 30 seconds
- [ ] Confirm `markdownChangedDuringRun = 0`

## Phase 7.5 Real Graph Quality — Step 3

- [x] Freeze 184 Claims / 42 Relations with Graph and Dataset fingerprints
- [x] Record builtAt, model, prompt version, relation policy version, and temperature
- [x] Generate all 42 Edge reviews
- [x] Generate 40 deterministic stratified unrelated reviews
- [x] Generate 30 deterministic source-diverse Orphan reviews
- [x] Confirm review progress is 0/42, 0/40, 0/30 before human annotation
- [x] Confirm incomplete evaluation fails with `Human Annotation Required`
- [x] Confirm LLM calls 0, Tavily calls 0, Markdown changes 0, Claim/Graph Store changes 0
- [ ] Complete human annotations with `npm run review:claim-graph`
- [ ] Run `npm run evaluate:claim-graph` only after all 112 annotations are complete
