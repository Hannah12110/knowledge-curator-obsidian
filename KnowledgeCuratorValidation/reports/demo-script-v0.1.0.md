# Knowledge Curator v0.1.0 — 5–8 Minute Demo

## Preparation

Use only `examples/demo-vault/` or `KnowledgeCuratorRegression/` fixtures in a disposable Vault. Do not copy or screen-share the real MyWiki, Claim Store, Graph Store, human annotations, or provider credentials.

For a write-free demonstration, use Production Preview. To demonstrate Accept, copy the synthetic demo files into `KnowledgeCuratorPhase1Test/{inbox,wiki,raw-技术}` so the fixed Test Mode Write Guard remains active.

## Scene 1 — Problem (45 seconds)

Open the synthetic Inbox source and explain the questions a knowledge curator must answer:

- Is this source worth adding?
- Is the knowledge already present under different wording?
- Does it conflict with accepted knowledge?
- Is the existing statement time-sensitive?

Position the product as claim-level governance, not AI summarization.

## Scene 2 — Source Analysis (45 seconds)

Click Analyze and show Related Wiki, source quality, knowledge gain and recommendation. Point out that retrieval sends selected context, not the entire Vault.

## Scene 3 — Claim-level Comparison (75 seconds)

Expand “知识点对比” and show the four outcomes:

- ADD: genuinely new knowledge
- REINFORCE: already covered; do not duplicate the Wiki
- REFINE: add scope, condition or mechanism
- CHALLENGE: potential conflict requiring verification

Emphasize that the Claim Store is derived from Wiki and can be rebuilt.

## Scene 4 — Conflict Verification (60 seconds)

Use the controlled conflict fixture. Show the generated query, ranked evidence, Tier and allowlisted URLs. Explain that only a conflict or explicit maintenance action triggers Tavily. If credentials are not configured, show the saved screenshots/report rather than entering a key on screen.

## Scene 5 — Knowledge PR (75 seconds)

Generate a Knowledge PR and show:

- Before / After
- target Wiki
- reason and evidence
- stale protection

In Production Preview, show that Accept is disabled. In a disposable Test Mode Vault, demonstrate Reject first; only demonstrate Accept when the target is inside the fixed test scope.

## Scene 6 — Claim Graph (60 seconds)

Open “知识关系建议.” Show related Claims and relation types, then state clearly:

> These are candidate relations suggested by the model. They are not facts automatically accepted by the system.

Do not rebuild the real Graph during the demo and do not trigger any graph-based write.

## Scene 7 — Safety Decision (60 seconds)

Show `compressionEligible = false` in the release decision. Explain that human audit and the Flash/v4-pro comparison found persistent supports/refines and related/unrelated errors. The Release Gate therefore blocked autonomous compression.

End with:

> AI can assist knowledge maintenance, but it should not modify knowledge automatically when its evaluated capability is insufficient.
