# Development Status

## Phase 0 ✅

Implemented:

- plugin scaffold
- sidebar
- settings
- markdown read
- local build-and-deploy workflow

Not implemented:

- LLM
- retrieval
- PR

Verification:

- production build passed
- TypeScript type check passed
- plugin load verified in Obsidian 1.13.7
- sidebar open and close verified
- all six settings persisted across a Vault reload
- Markdown read and sidebar metadata display verified
- missing file error handling verified
- local deploy verified with environment variable and `.env.local`
- deployed artifacts verified by checksum
- manifest and runtime bundle contract verification added
- fresh deploy and reload verified in MyWiki on Obsidian 1.13.7

## Phase 1 ✅

Implemented:

- settings-driven Inbox, Raw, and Wiki paths
- recursive Inbox Markdown scanning
- non-Markdown filtering
- modified-descending sorting
- frontmatter title, author, source, and tags reading
- title fallback to basename
- Inbox list, count, pending/failed state, and modified date
- Open and Refresh actions
- missing and empty Inbox states
- read-only Wiki and Raw listing
- deleted-file and per-file read error handling
- Chinese Sidebar and Settings copy
- real MyWiki Markdown test fixtures copied into `KnowledgeCuratorPhase1Test/`

Not implemented:

- LLM
- Analyze
- semantic retrieval
- duplicate or knowledge-gain decisions
- conflict detection
- web search
- Knowledge PR
- Vault content writes
- multiple Raw source folders (the current setting accepts one Raw Folder only;
  `raw-技术` is configured for testing and `raw-产品` is retained as a separate
  copied fixture for a later phase)

Verification:

- build and TypeScript checks passed
- plugin load and Sidebar rendering verified in Obsidian 1.13.7
- recursive and non-Markdown filtering fixtures passed
- frontmatter and basename fallback passed
- modified-descending sorting passed
- Open and manual Refresh passed
- missing and empty folder states passed
- malformed frontmatter isolation passed
- failed-file state passed
- file-deleted-after-scan handling passed
- Wiki and Raw service listing passed
- real-file Inbox titles and `YYYY-MM-DD` dates passed
- Open action verified against the test copy path rather than the source path
- copied fixtures verified byte-for-byte against their source files
- original MyWiki source files verified unchanged by SHA-256 checksum

## Phase 2 ✅

Implemented:

- OpenAI-compatible Chat Completions client
- separate View → Controller → Analysis → Retrieval/LLM architecture
- legacy `rawFolder` migration and multiple `rawFolders` support
- configurable `maxRelatedNotes` with a default of 8
- title, tag, heading, Wiki-link, body-keyword, and lexical candidate scoring
- Wiki priority and separate Wiki / Raw prompt sections
- bounded source, related-note, and total-context lengths with truncation metadata
- strict SourceAnalysis runtime validation
- one retry after malformed model JSON
- DeepSeek JSON-mode compatibility with a concrete JSON example, explicit
  `max_tokens`, non-streaming requests, and official-endpoint thinking disabled
- one retry after an empty provider response, with a clear final empty-response error
- safe provider diagnostics for HTTP status, model, finish reason, choices,
  empty content, JSON mode, thinking mode, and retry count
- explicit truncated-output handling for `finish_reason = length`
- Chinese handling for missing configuration, 401, 403, 404, 429, 5xx, timeout, network, and invalid-response errors
- pending, analyzing, analyzed, and failed Inbox states
- Analyze, View Analysis, Reanalyze, and Retry actions
- read-only Chinese analysis result UI
- path + mtime analysis cache in plugin `data.json`
- session-scoped Sidebar restoration across plugin reload when the View was open
- strict configured-folder boundaries for Inbox, Wiki, and multiple Raw sources
- Retrieval final scope guard with path-only diagnostic logging
- cache scope snapshots that invalidate analysis created under other folder settings
- full Vault-relative identity enforcement for Related Notes and `duplicateWith`

Not implemented:

- web search or external fact verification
- conflict resolution
- Knowledge PR, diff, accept, or reject workflow
- Wiki, Raw, or Inbox Markdown writes
- embeddings or vector database
- claim store, freshness, knowledge health, or compression

Verification:

- TypeScript type check passed
- production build and bundle contract verification passed
- 33 pure-function, path-scope, retrieval, cache, LLM, and Sidebar tests passed
- legacy single Raw Folder migration passed
- both real Raw test folders were loaded
- real-fixture retrieval ranking passed for Memory, Evaluation, and Harness cases
- successful OpenAI-compatible request and SourceAnalysis cache verified with a local mock endpoint
- invalid API Key and missing API Key produced safe Chinese failure states
- analyzed, view analysis, reanalyze, and retry controls rendered in Obsidian 1.13.7
- original and copied Markdown checksums remained unchanged
- Phase 2 view-analysis bug fixed: analysis now opens in a dedicated detail
  mode with an explicit return action instead of rendering below the Inbox list
- valid cache, missing cache, changed mtime, Sidebar reopen, and plugin reload
  analysis-detail paths verified
- real `deepseek-flash` non-streaming analyses returned non-empty, validated
  SourceAnalysis for Harness Engineering, Agent Memory, and Agent evaluation
- DeepSeek default thinking exhaustion was reproduced as `finish_reason = length`
  with empty content, then resolved by disabling thinking for the official endpoint
- Sidebar reload regression reproduced as `leafCount 1 → 0`, traced to unload
  detaching the View without a matching restore path, and fixed with conditional
  `onLayoutReady` restoration
- Command Palette and Ribbon entry opened the View successfully; open Sidebar
  survived plugin reload, intentionally closed Sidebar remained closed, and no
  View constructor, `onOpen`, or render errors were captured
- same-basename Wiki/Raw files outside configured test folders, `inbox-old`,
  basename-only duplicate identities, cross-scope cache reuse, and out-of-scope
  cached Related Notes are rejected by automated tests
- real Agent Memory, Harness, and Evaluation analyses produced zero scope
  violations; all source, candidate, Related Note, and cache paths use full
  Vault-relative paths under `KnowledgeCuratorPhase1Test/`

## Phase 3 ✅

Implemented:

- strict `KnowledgePR`, `KnowledgeChange`, Evidence, fingerprint, and History types
- runtime Knowledge PR proposal and immutable-field validation
- deterministic highest-relevance Wiki target selection with safe Create fallback
- fixed write scope guard for `KnowledgeCuratorPhase1Test/wiki/`
- minimal Before/After diff UI with Chinese Accept All / Reject All actions
- full Vault-relative path identity and SHA-256 + mtime stale checks
- exact, unique `before` matching and back-to-front local patch application
- create collision, path traversal, same-prefix, and real-Wiki write rejection
- plugin `data.json` Knowledge PR cache across Sidebar close and plugin reload
- accepted and rejected audit records under `.knowledge-agent/history/`
- Adapter-backed hidden History directory support
- automatic Wiki rollback when History persistence fails
- DeepSeek-compatible Knowledge PR prompt with a concrete Update JSON example

Not implemented:

- Phase 4 web search or external conflict verification
- per-change edit, accept, or reject
- Raw move, delete, replacement, or lifecycle automation
- Inbox moves or source frontmatter writes
- writes outside `KnowledgeCuratorPhase1Test/wiki/`
- embeddings, vector database, Claim Store, or Agent framework

Verification:

- TypeScript type check passed
- 49 validator, scope, cache, retrieval, LLM, patch, decision, History, and rollback tests passed
- production build and deployed bundle checksum verification passed
- real DeepSeek PRs generated for Harness Engineering, Agent Memory, and Agent evaluation
- all three real target selections stayed inside the configured test Wiki
- Harness PR Reject preserved the target SHA-256 and wrote rejected History
- Agent Memory PR Accept changed only its test Wiki SHA-256 and wrote accepted History
- accepted PR state and read-only decision UI survived plugin reload
- source Inbox/Raw hashes and 113 real MyWiki Markdown hashes remained unchanged
- only `KnowledgeCuratorPhase1Test/wiki/Agent Memory 设计与评测.md` changed among test Wiki fixtures
- stale mtime/hash, missing/duplicate baseline, create collision, and History rollback passed automated verification

## Phase 4 ✅

Implemented:

- conflict-only external verification entry in the analysis detail view
- Tavily Search Provider abstraction and snippet-only search request
- one to three bounded, deduplicated conflict queries
- canonical URL and domain-title result deduplication
- explainable Tier 0–4 source scoring with primary-source, relevance, recency, and independence signals
- strict `ExternalEvidence` and `ConflictVerificationResult` runtime validation
- `SUPERSEDE`, `REFINE`, and `UNRESOLVED` resolution policies
- one retry after invalid verification JSON
- Chinese handling for missing Search API key, 401, 403, 429, timeout, 5xx, empty, and malformed results
- prompt-injection boundary that treats search result text as untrusted data
- verification cache keyed by conflict content, generated queries, provider, and model
- malformed persisted verification cache isolation
- Chinese verified-conflict UI with source tier, support direction, confidence, conclusion, reasoning, and safe external link actions
- Knowledge PR external evidence references
- verified conflict invalidates an existing draft PR
- `replace` requires a bound `SUPERSEDE` policy and authorized external evidence
- unverified, `REFINE`, and `UNRESOLVED` conflicts cannot replace old knowledge
- Phase 4 settings for Tavily API key and per-query result limit

Not implemented:

- Phase 5 or automated freshness monitoring
- background or periodic web search
- full-page crawling or webpage storage
- Claim Store
- vector database or embeddings
- automatic canonical-source replacement
- automatic Raw move or deletion
- direct Phase 4 Markdown writes
- multiple Search Providers

Verification:

- TypeScript type check passed
- 79 cache, provider, ranking, validation, retry, PR-policy, prompt-injection, and write-boundary tests passed
- production build and bundle contract verification passed
- deployed bundle checksum matched the source build
- plugin loaded in MyWiki and the command opened the Phase 4 Sidebar
- an open Sidebar survived plugin reload
- synthetic in-memory conflict rendering displayed `REFINE`, Tier 0, confidence, evidence, and source action without persisting test data
- missing legacy `verificationCache` migrated to an empty runtime object
- 131 MyWiki Markdown files, including 113 outside the test directory, remained byte-identical during Phase 4 deployment and UI verification
- real Phase 4 E2E fixtures were created only under `KnowledgeCuratorPhase1Test/` and marked `Phase 4 E2E Test Fixture`
- real DeepSeek Phase 2 analysis retrieved the dedicated test Wiki and produced two conflicts
- real Tavily verification completed four HTTP 200 searches, with 20 raw results and two validated `UNRESOLVED` resolutions
- unknown-domain ranking fallback was tightened from Tier 2 to Tier 3 after real-result review; recognized professional engineering domains remain Tier 2
- ranking policy versioning invalidated stale verification cache after the ranking change
- every persisted Evidence URL matched the canonical URL allowlist from the corresponding real Tavily results
- a real pre-verification draft PR became `stale`; the regenerated PR used only `refine` and external Evidence, with no `replace`
- Reject preserved Inbox and Wiki SHA-256 values and wrote rejected History
- Accept changed only `KnowledgeCuratorPhase1Test/wiki/phase4-conflict-wiki.md`; accepted History `afterHash` matched the actual file
- all 113 Markdown files outside `KnowledgeCuratorPhase1Test/` remained unchanged

## Phase 4.5 ✅

Implemented:

- 12-case synthetic Regression Dataset with duplicate, partial increment, new knowledge, conflict, low-quality, target-selection, and provider-error coverage
- flexible expected labels, checked-in contract-output snapshots, JSON / Markdown reports, baseline comparison, and release gates
- unified `WorkflowState` and Chinese next-action CTA mapping
- unified safe `CuratorError` model with stage, code, retryability, and console-only technical detail
- duplicate-operation protection for Analyze, Verify, Generate PR, Accept, and Reject
- Test Mode and read-only Production Preview, enforced in both UI and write service
- Accept confirmation showing the exact target Wiki and Test Mode label
- grouped Settings for Knowledge Scope, LLM, Retrieval, Search, Privacy, and Maintenance
- password API Key fields, explicit external data disclosure, and no-secret regression-report guard
- confirmed clearing of Analysis, Verification, and draft/stale PR caches
- History count with no prominent destructive History action
- README Quick Start, architecture, privacy/data flow, mode boundary, regression gate, demo data, and known limitations
- synthetic `examples/demo-vault/` content
- `RELEASE_CHECKLIST.md`
- manifest / package / versions consistency audit for version `0.1.0`

Not implemented:

- Phase 5
- Production Wiki write
- live-provider execution inside `npm run regression` (the first gate evaluates checked-in contract-output snapshots)
- Claim Store, Vector DB, Freshness Engine, background jobs, or knowledge compression
- full-page external crawling

Verification:

- TypeScript type check passed
- 87 automated tests passed
- 12/12 regression contract cases passed with no PASS-to-FAIL baseline regression
- all reported quality metrics passed the first small-sample release gate; sample sizes are included in the report
- production build and bundle verification passed; bundle imports only `obsidian`
- deployed artifact checksum matched the source build
- plugin loaded in Obsidian 1.13.7; Sidebar restored after reload and Console reported no plugin error
- Sidebar rendered Phase 4.5, Test Mode, unified workflow labels, and explicit CTAs

## Phase 5 ✅

Implemented:

- local, rebuildable Claim Store derived only from configured Wiki Markdown
- strict ClaimRecord, provenance, CandidateClaim, comparison, store, status, and schema types
- conservative Claim normalization and deterministic path/scope/qualifier-sensitive Claim IDs
- validated LLM Claim extraction with one retry, deduplication, and a 30-Claim retained limit
- incremental hash-based indexing, deleted-file cleanup, partial recovery, cancel, retry, and rebuild
- configured-Wiki scope isolation for persisted Claim Store data
- lexical Claim Retrieval Top K without embeddings or a vector database
- `ADD`, `REINFORCE`, `REFINE`, and `CHALLENGE` comparison with deterministic qualifier/numerical safeguards
- initial `SUPERSEDE` downgrade to `CHALLENGE`; replacement still requires Phase 4 verification
- Claim-level SourceAnalysis aggregation, Claim Coverage, summary UI, and collapsible comparison detail
- Knowledge PR relation policy: ADD → add, REFINE → refine, REINFORCE → no duplicate body, CHALLENGE → verify first
- Accept re-indexes the final Wiki; Reject leaves Claim Store unchanged
- Analysis Cache schema v4 with mode, Top K, Claim Store revision, and aggregation-semantics invalidation
- Claim Mode default and Legacy Document Mode fallback
- 8 additional claim-level regression cases and four Claim quality metrics
- local Claim Store privacy disclosure and maintenance controls

Not implemented:

- embeddings or vector database
- Claim Store as Source of Truth
- Raw-to-Existing-Claim promotion
- Freshness Engine or scheduled monitoring
- Claim graph or Knowledge Compression
- Production Wiki write access
- Phase 6 features

Verification:

- TypeScript type check passed
- 115 automated tests cover normalization, identity, validation, corruption, incremental indexing, scope isolation, retrieval, relation safety, False New prevention, PR policy, Accept/Reject indexing, Legacy fallback, and cache invalidation
- 20-case regression dataset includes 8 Claim-level cases while preserving all Phase 4.5 cases
- Phase 5 release gates passed: Claim Retrieval Top1 100% (n=7), Top3 100% (n=7), Relation Agreement 100% (n=8), and False New Rate 0% (n=7)
- Claim Store remains a local derived JSON index and does not write Markdown
- Settings rendered all six groups; LLM and Search keys remained masked
- Production Preview read-only label rendered in the live Sidebar; write-service bypass test passed
- real DeepSeek Claim Mode E2E covered a high-duplicate source, a partial-increment source, and a conflict source; the conflict continued into real Tavily + DeepSeek verification
- Test Mode generated a relation-aware draft containing only its single ADD; Reject preserved the target Wiki hash and did not update Claim Store
- Claim Store build completed with 184 Claims from 7 Wiki, 0 failed files, and 7 LLM calls in 155015 ms; a subsequent incremental pass used 7 cache hits, 0 LLM calls, and completed in 111 ms
- deployed bundle checksum matched the source build; Obsidian 1.13.7 loaded it, restored the Sidebar after reload, and reported no plugin errors
- no existing Markdown content hash was changed by Phase 5 operations; one marked test fixture was added under `KnowledgeCuratorPhase1Test/inbox/`
- the long-running Vault audit also observed concurrent user/external reorganization outside the test scope (51 same-hash moves, 4 additions, 1 deletion); these paths were not touched by plugin commands and were left unchanged

## Phase 5.1 ✅

Implemented:

- staged Claim Retrieval v2: normalize → expand → Top-20 candidate pool → feature score → deterministic re-rank → Top K
- Chinese bigram/trigram tokenization, mixed-language tokens, technical phrase preservation, and Chinese/English stop words
- English plural/hyphen cleanup while preserving numbers, percentages, model names, years, and version tokens
- maintainable acronym and bilingual technical-term dictionaries under `src/knowledge/`
- retrieval-positive qualifier and negation differences so conflicting claims remain comparable
- explainable topic, type, phrase, token, alias, acronym, qualifier, negation, and provenance features
- centralized score weights and per-match debug reasons without extra LLM calls
- Claim Retrieval v1 retained for offline A/B; production uses `claim-retrieval-v2`
- Analysis Cache schema v5 and retrieval-version invalidation; Claim Store rebuild is not required
- 10 new retrieval-focused regression cases and bilingual/acronym/conflict/False-ADD-miss metrics
- deterministic 184/1k/5k/10k CPU benchmark and a complete 20-ADD Harness human audit

Not implemented:

- embeddings, vector database, cross-encoder, or external rerank API
- user-editable alias dictionary
- broad translation or heavyweight NLP service
- Claim Comparison prompt changes to hide retrieval errors
- Phase 6 features

Verification:

- 30/30 regression cases pass with v2 Top1 100% (n=17), Top3 100% (n=17), Relation Agreement 100% (n=18), and False New Rate 0% (n=17)
- v1 → v2: Top1 88.2% → 100%, Top3 94.1% → 100%, False ADD Retrieval Miss 5.9% → 0%
- Bilingual Recall 100% (n=2), Acronym Recall 100% (n=1), Conflict Retrieval Recall 100% (n=3)
- Harness audit: 13 True ADD, 0 Retrieval Miss, 4 Comparison Error, 3 Unclear; live aggregate changed 19/7/4 to 20/6/4 because only 14/30 extracted candidates were identical between provider runs
- 124/124 automated tests, 30/30 regression cases, typecheck, production build, and bundle verification pass
- current-store benchmark: 184 Claims avg 1.250 ms / P95 3.225 ms; 30 candidates completed in 17.656 ms
- synthetic benchmark: 1k avg 6.236 ms / P95 14.450 ms; 5k avg 9.710 ms / P95 14.649 ms; 10k avg 17.166 ms / P95 19.911 ms
- real Agent Memory returned 18 ADD / 5 REFINE / 6 REINFORCE / 1 CHALLENGE after one safe network retry
- real conflict fixture returned 2 CHALLENGE and preserved the Phase 4 unverified-conflict path
- Phase 5.1 retrieval remains read-only and adds no external provider or Markdown write path

## Phase 5.2 ✅

Implemented:

- fixed Candidate + Retrieval v2 Top K comparison dataset for deterministic v1/v2 A/B
- pairwise equivalent / broader / overlap / conflict analysis and multi-Claim Coverage
- strict `none → ADD`, `partial → REFINE`, `full → REINFORCE`, `conflicting → CHALLENGE` mapping
- deterministic exact, qualifier, negation, and numeric guards with confidence capping
- bounded six-Candidate provider batches, one invalid-result retry, and fail-closed behavior
- Analysis Cache schema v6 with `claim-comparison-v2` context invalidation
- Chinese Coverage UI and REFINE PR instructions limited to uncovered aspects
- Harness and Agent Memory fixed audits plus coverage/error-rate regression metrics

Not implemented:

- embeddings, vector database, cross encoder, external reranker, or Claim Graph
- automatic fallback from failed Coverage to ADD or Legacy Mode
- Phase 6 features

Verification:

- 80/80 regression cases pass; Coverage Agreement 100% (n=50), Comparison v2 Relation Agreement 100% (n=50)
- False ADD Comparison Error 75% → 0% (n=16); False REINFORCE remains 0% (n=28)
- Harness fixed audit resolves 4/4 labeled comparison errors; Agent Memory fixed audit resolves 1/1
- real DeepSeek Harness: 30 Candidates, 5 comparison calls, 46.2 s, 14 ADD / 12 REFINE / 3 REINFORCE / 1 CHALLENGE
- real DeepSeek Agent Memory: 30 Candidates, 5 comparison calls, 41.2 s, 23 ADD / 3 REFINE / 1 REINFORCE / 3 CHALLENGE
- real conflict fixture: 8 Candidates, 3 comparison calls including one schema retry, 2 CHALLENGE preserved
- 134/134 automated tests, typecheck, regression, production build, bundle verification, deploy, Sidebar reload, and runtime error check pass
- Phase 5.2 analysis and comparison did not modify Inbox, Raw, or Wiki Markdown

## Phase 5.3 ✅

Implemented:

- independent Candidate-level Comparison Cache with complete Candidate, Top K Claim, version, provider, model, and prompt fingerprints
- 5,000-entry timestamp eviction, corruption-safe load, explicit Settings clear action, and no Markdown-backed cache storage
- conservative deterministic Fast Path for exact/very-high-confidence equivalence and obvious numeric, negation, or absolute-qualifier conflict
- mandatory Coverage/Relation validation for cache, Fast Path, and provider results with no silent ADD or Legacy fallback
- dynamic comparison batch packing with a hard six-Candidate maximum and estimated input/output budget
- concurrency-limited scheduler with stable Candidate ordering, maximum concurrency two, bounded transient retry, and 429/timeout/5xx recovery
- per-Candidate persistence so completed comparisons survive another batch failure and are reusable on retry
- isolated single-Candidate recovery when a real provider returns a schema-invalid or truncated multi-Candidate response after its bounded batch retry
- execution metrics for cache hits, Fast Path, LLM Candidates, calls, batches, retries, total duration, and batch durations
- fixed Harness, Agent Memory, and conflict performance fixtures with cold, warm, and partial-change benchmarks
- `comparison-execution-v1` execution version while preserving `claim-comparison-v2` decision semantics and Analysis Cache schema v6

Not implemented:

- embeddings, vector database, cross encoder, external reranker, or Phase 6 features
- a dedicated Sidebar cancellation button for Source comparison
- a provider-wide shared rate-limit circuit breaker across unrelated analyses
- a hard requirement that every completely cold 30-Candidate Source use fewer than five calls; conservative quality gates take priority

Verification:

- 149/149 automated tests, 80/80 regression cases, typecheck, production build, bundle verification, and deploy passed
- Phase 5.2 quality remained unchanged: Coverage Agreement 100% (n=50), Relation Agreement 100% (n=50), False ADD Comparison Error 0% (n=16), and False REINFORCE 0% (n=28)
- fixed Harness warm benchmark reused 30/30 Candidate results with zero LLM calls; one changed Candidate reused 29/30 and required one call
- fixed Agent Memory warm benchmark reused 30/30 Candidate results with zero LLM calls; one changed Candidate reused 29/30 and required one call
- fixed conflict benchmark kept two safe Fast Path decisions with 100% controlled precision and sent the remaining six Candidates in one provider batch
- real DeepSeek Harness analysis completed with 30 Candidates after isolated schema-recovery; previously successful Candidate cache entries were retained across failed attempts
- plugin loaded in Obsidian 1.13.7, Sidebar opened, and the Phase 5.3 analysis detail rendered successfully
- Phase 5.3 did not directly modify Inbox, Raw, or Wiki Markdown; all new mutable state is plugin-local derived cache

## Phase 6 ✅

Implemented:

- deterministic local Freshness Risk scoring with Low / Medium / High / Critical classification and explainable factors
- historical/version-scope and stable-definition guards; age alone never marks a Claim stale
- Vault-local Maintenance Store with corruption isolation, incremental policy-version reuse, queue sorting, filters, and persistence
- separate Chinese 知识维护 Sidebar flow with explicit local scan and per-Claim verification CTA
- user-triggered Tavily freshness queries, Phase 4 Tier ranking reuse, evidence URL allowlist, and prompt-injection boundary
- strict `still_valid / needs_refinement / stale / disputed / insufficient_evidence` runtime validation with one bounded retry
- Tier 0/1 plus historical-scope safety gates for `stale`
- Freshness verification cache keyed by Claim fingerprint, query, provider, ranking/verification versions, and model
- Maintenance PR reuse of Knowledge PR, History, stale target fingerprints, rollback, Test Mode write scope, and target-only Claim Store re-index
- resolution policy: still-valid/insufficient produce no body PR, refine permits only refine, stale permits replace, disputed forbids replace
- privacy disclosure, maintenance settings, cache clearing, regression fixtures, metrics, and local benchmark
- three explicitly marked Phase 6 E2E fixtures under the isolated test Wiki

Not implemented:

- background/scheduled risk scans or automatic web verification
- notifications, embeddings, vector database, Claim Graph, knowledge compression, or Raw lifecycle
- production Wiki writes, automatic delete, automatic supersede, or Phase 7 features

Verification:

- 192/192 automated tests pass, including no-network scan, verification retry/cache, weak-evidence/historical guards, Maintenance Accept/Reject, re-index, Production Preview block, and official Claude documentation ranking
- 110/110 regression cases pass with no existing PASS→FAIL regression
- Freshness Risk Agreement 100% (n=20), High-risk Recall 100% (n=20), Low-risk False Alarm 0% (n=20)
- Freshness Verification Agreement 100% (n=10), Unsafe Replace Rate 0% (n=10)
- local 184-Claim risk benchmark completed in 18.55 ms with zero network calls
- typecheck and production build with bundle verification pass
- real Tavily + DeepSeek verification completed for a Critical Claim: two bounded queries, Tier 0 Claude official evidence, `still_valid`, confidence 0.88, and reload-persistent Maintenance Store metadata
- the real `still_valid` result correctly produced no body PR; Maintenance PR Reject/Accept paths remain covered by guarded automated integration tests
- Risk Scan, Verification, Draft, and Reject are non-writing; Maintenance Accept remains restricted to `KnowledgeCuratorPhase1Test/wiki/`

## Phase 7 ✅

Implemented:

- local `.knowledge-agent/claim-graph/store.json` with strict nodes, edges, metadata, and evolution validation
- sparse Retrieval v2 signal index and bounded candidate generation; no all-pairs comparison, embeddings, or vector database
- LLM relation classification for duplicate / supports / refines / contradicts / depends_on plus explicit none
- runtime guards for endpoint Claim IDs, relation enum, confidence, evidence, source path, and schema version
- derived created / refined / challenged / superseded Claim evolution events
- `contradicts` routing into the existing Phase 4 external verification chain without automatic resolution or Wiki writes
- Chinese 知识关系 and 知识健康概览 UI with Claim / Relation / Conflict / Duplicate / Orphan metrics
- read-only canonical compression previews authorized only by high-confidence duplicate components
- Graph staleness detection when Claim Store revision or Graph policy changes
- 24-case Claim Graph regression dataset and Graph Relation Accuracy / Unsafe Merge / Orphan metrics
- 1,000-Claim local candidate-generation benchmark with a 500-pair global bound
- Settings privacy disclosure and explicit manual build action

Not implemented:

- automatic compression, merge, delete, or canonical Claim write
- background Graph builds or periodic relation discovery
- embeddings, vector databases, cross encoders, Claim Graph canvas, or graph query language
- Production Preview writes or any bypass around Knowledge PR / Verification / Write Guard
- Phase 8

Verification:

- TypeScript type check passed
- 202 automated tests passed, including Graph validation, corruption isolation, sparse candidate generation, retry, evidence, and unsafe-compression guards
- 134/134 regression cases passed; Graph Relation Accuracy 100% (n=24), Unsafe Graph Merge 0% (n=24), Orphan Detection 100% (n=2)
- 1,000-Claim benchmark retained 500 of 499,500 possible pairs (0.10%); candidate generation remained bounded and made no provider/network call
- Phase 7 Graph and Compression modules have no Markdown write dependency; all writes remain in the pre-existing guarded Knowledge Write service

## Phase 7.5 — Step 1 ✅

Implemented:

- read-only real Vault Snapshot with relative path, SHA-256, size, and strict Inbox / Wiki / Raw counts
- deterministic Snapshot ID and `phase7.5-v1` report version
- Document / Claim / Claim Graph Baseline with relation distribution
- explicit `not_built` / `corrupt` derived-store handling instead of fabricated metrics
- repository-isolated `KnowledgeCuratorValidation/` output; generated private-path JSON is Git-ignored
- `npm run benchmark:vault` with real-Vault before/after safety comparison
- local 1000 Markdown / 10000 Claims performance benchmark with no LLM or network
- 8 Snapshot/Baseline automated tests, including add/delete/hash-change and strict folder boundaries

Not implemented in this step:

- Phase 7.5 human review datasets
- Graph quality and conflict safety evaluation
- Compression evaluation
- Validation Dashboard
- final Phase 7.5 release gate or Phase 8

Verification:

- current MyWiki Snapshot: 168 Markdown, 10 configured test Wiki, 5 configured Raw, 7 configured Inbox
- current Claim baseline: 184 Claims / 7 indexed Wiki; Claim Store ready
- current Graph baseline: not built, therefore 0 nodes / 0 edges are reported explicitly
- real Snapshot 41.25 ms; Baseline 0.05 ms
- synthetic 1000 Markdown Snapshot 9.61 ms; 10000 Claims Baseline 0.60 ms
- 210/210 automated tests and TypeScript typecheck pass at Step 1 checkpoint
- validation run changed zero MyWiki Markdown files

## Phase 7.5 — Step 2 ✅

Implemented:

- real 184-Claim sparse Graph build with stable canonical Pair keys and a 500-Pair bound
- separate raw-scored-pair and final-classifier-pair metrics
- DeepSeek relation classification with strict Candidate membership, exactly-once, enum, confidence, and Evidence validation
- bounded schema retry plus smaller-batch / single-Pair recovery with explicit unrecovered failure reporting
- Claim Graph schema v2 build metadata, relation distribution, orphan IDs, Claim Store fingerprint, and safety counters
- guarded headless real-provider runner that can write only `.knowledge-agent/claim-graph/store.json`
- JSON and Markdown validation reports under `KnowledgeCuratorValidation/reports/`
- serialize/load persistence verification and isolated Claim revision stale-invalidation verification
- explicit `none` / unrelated Evidence contract discovered and corrected during the first real-provider attempt

Not implemented in this step:

- human Ground Truth relation labels or Relation Accuracy evaluation
- Duplicate Precision, Conflict Recall, Compression Evaluation, or Validation Dashboard
- automatic conflict verification, Tavily search, compression write, Knowledge PR Accept, or Markdown mutation
- Phase 8

Verification:

- real input: Snapshot `64fe49b8...50f30c`, 168 Markdown, 184 Claims, Claim Store ready
- candidate generation: 2,780 unique locally scored combinations → 184 final classifier Pairs (1.09% of 16,836 possible pairs)
- real DeepSeek execution: 19/19 successful calls, 19 batches, zero retries, zero schema-invalid results, zero failed Pairs
- Graph Store ready with 184 nodes and 45 edges: duplicate 3, supports 26, refines 12, contradicts 3, depends_on 1; 139 unrelated classifications and 122 orphan Claims
- persisted Store reload matched node, edge, relation, and Claim Store fingerprint metadata
- isolated Claim Store revision change marked Graph stale
- TypeScript, 236/236 tests, 134/134 regression cases, production build, and Vault benchmark passed
- Tavily calls 0, Knowledge PR Accept 0, automatic conflict resolution 0, automatic compression writes 0
- MyWiki Markdown changed 0, deleted 0, moved 0, added 0
- current 184-Claim / 42-Relation Graph manual UI reload, ready status, stale transition, and Markdown safety were confirmed by the user before Step 3 freeze

## Phase 7.5 — Step 3 ⏸ Human Annotation Required

Implemented:

- frozen evaluation manifest for the user-confirmed 184-Claim / 42-Relation Graph
- immutable baseline metadata: Graph fingerprint, builtAt, model, prompt version, relation policy version, and temperature
- all 42 persisted Edges in a blind human-review dataset
- deterministic unrelated audit: 40 Pairs stratified as high 20 / medium 10 / low 10 retrieval similarity
- deterministic Orphan audit: 30 Claims distributed across all 7 indexed Wiki sources, each with local Retrieval v2 Top 5
- resumable blind-review CLI with immediate local persistence and post-submit prediction reveal
- fail-closed evaluator for Edge Precision, Relation Accuracy, Direction Accuracy, per-relation precision, sampled unrelated FN rate, false-Orphan rate, and root-cause attribution
- stale guards for Claim Store / Graph fingerprint changes; old annotations are never silently migrated
- 36 Step 3 automated tests; full suite now 272/272 PASS

Current frozen baseline:

- Graph fingerprint: `02f0a0fb63a611b673f66874efa2923527fe390efc37ad864634c4ff687e7d13`
- Dataset fingerprint: `66328e05c4b6e882e7496bc3de21d8983d817f8b3c465161a2561745e7744217`
- Provider context: `deepseek-flash`, prompt `claim-graph-relation-prompt-v2`, relation policy `claim-graph-relations-v1`, temperature `0.1`
- Human review progress: Edge 0/42, Unrelated 0/40, Orphan 0/30
- Known limitation: the same Claim Store changed from 45 to 42 Relations after LLM reclassification; quality results must not mix Graph fingerprints

Not completed:

- human Ground Truth annotations
- real Edge Precision / Relation Accuracy / Direction Accuracy
- any Retrieval or classifier optimization
- Compression Evaluation, Dashboard, or Phase 8

Safety:

- Dataset generation / review / evaluation use zero LLM and zero Tavily calls
- MyWiki Markdown hashes remained unchanged (169/169 files in the current filesystem snapshot)
- Claim Store and Claim Graph hashes remained unchanged

## Phase 7.5 — Step 5 ✅ Product Closeout

Final release boundary:

- Knowledge Curator MVP: `COMPLETE`
- Claim Graph: `HUMAN_IN_THE_LOOP`
- Autonomous Compression: `BLOCKED_BY_QUALITY_GATE`
- Production Safety: `PASS`
- Relation Model Quality: `LIMITED`

Closeout decisions:

- Claim Graph is an AI-assisted relation suggestion layer, not a Ground Truth Knowledge Graph.
- Runtime relations are model suggestions and cannot directly authorize merge, delete, rewrite, or Knowledge PR replace.
- Compression Evaluation was intentionally blocked because neither DeepSeek Flash nor v4-pro passed the frozen autonomous relation gate.
- No Prompt v7, further model choice, relation taxonomy redesign, Graph RAG, or Phase 8 work is part of this release.

Final real-data evidence:

- Claim Store: 184 Claims / 7 indexed Wiki
- Human review: 43/43 Edge, 13/40 Unrelated, 0/30 Orphan
- DeepSeek Flash: 93.0% Edge Precision, 72.1% Relation Accuracy, 93.5% Direction Accuracy
- DeepSeek v4-pro: 93.0% Edge Precision, 69.8% Relation Accuracy, 86.7% Direction Accuracy
- model-choice result: `MODEL_INDEPENDENT_LIMITATION`
- `productionCandidate = null`; `compressionEligible = false`

Release artifacts:

- `KnowledgeCuratorValidation/reports/phase7-final-release-decision.md`
- `KnowledgeCuratorValidation/FINAL_RELEASE_CHECKLIST.md`
- `KnowledgeCuratorValidation/reports/portfolio-summary.md`
- `KnowledgeCuratorValidation/reports/interview-story.md`
- concise final `README.md`
- read-only `npm run verify:final-closeout`
