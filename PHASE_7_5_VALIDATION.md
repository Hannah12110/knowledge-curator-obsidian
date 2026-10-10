# Phase 7.5 Real Vault Validation

## 当前进度

Step 1 Snapshot / Baseline 与 Step 2 真实 Graph Build 已完成。Step 3 已冻结当前 184 Claims / 42 Relations Graph，并生成盲审数据集；当前停在 `Human Annotation Required`，尚未产生任何真实质量 Accuracy。

## Step 3 人工盲审

```bash
npm run review:claim-graph -- --vault /absolute/path/to/vault
```

审核范围：42 条 persisted Edge 全量、40 条 unrelated 分层样本、30 条 Orphan 分层样本。CLI 每提交一条立即写入本地 `annotations.json`，可中断后 Resume；模型 Relation、confidence 与 evidence 只在人工提交后显示。

检查进度：

```bash
npm run review:claim-graph -- --vault /absolute/path/to/vault --progress
```

全部 112 条完成后才可运行：

```bash
npm run evaluate:claim-graph -- --vault /absolute/path/to/vault
```

未完成时评测命令会以 `Human Annotation Required` fail closed。

## 运行方式

```bash
npm run benchmark:vault -- --vault /absolute/path/to/vault
```

或在未提交的 `.env.local` 中配置 `TEST_VAULT=/absolute/path/to/vault`，然后运行 `npm run benchmark:vault`。

## 输出

- `KnowledgeCuratorValidation/snapshot/snapshot.json`
- `KnowledgeCuratorValidation/reports/baseline.json`
- `KnowledgeCuratorValidation/reports/vault-benchmark.json`

所有报告都带有 `version = phase7.5-v1`、生成时间和 Snapshot 关联信息。Snapshot ID 只由排序后的文件相对路径、大小和 SHA-256 生成；同一 Vault 内容重复运行会得到相同 ID。

## 指标解释

- `markdownCount`：排除 `.obsidian`、`.trash`、`.knowledge-agent` 后的 Vault Markdown 数量。
- `wikiCount` / `rawCount` / `inboxCount`：严格按照插件当前 Settings 的目录边界计数。
- `claims`：当前本地 Claim Store 中通过 runtime validation 的 Claim 数。
- `graphNodes` / `graphEdges` / `relations`：当前本地 Claim Graph Store 的基线；尚未建立 Graph 时明确显示 `graphStatus = not_built` 和零值，不伪造指标。

## 安全边界

- Snapshot source 接口只暴露 `listMarkdownFiles` 与 `readBytes`，没有写方法。
- 命令不调用 LLM、不调用 Tavily、不构建 Claim Store 或 Claim Graph。
- 输出只写入仓库侧 `KnowledgeCuratorValidation/`，不写入 MyWiki。
- 命令会在运行前后重新生成 Snapshot；若发现 Markdown 变化则失败。
- 报告不包含 Markdown 正文、API Key、Prompt 或 History。
- Step 3 Dataset / Annotation 目录已被 `.gitignore` 保护；只保存必要 Claim statement、相对 sourcePath、Claim ID 和指标。
- Step 3 不调用 LLM / Tavily，不修改 Claim Store / Graph Store，不触发 Knowledge PR 或 Compression Write。

## 性能门槛

- 1000 Markdown Snapshot `< 5s`
- 10000 Claims Baseline `< 30s`

真实网络与 LLM 不参与该基准。

## 已知限制

- 当前 Step 3 只有评测管线 PASS，人工标注尚未完成，因此没有 Edge Precision / Relation Accuracy 结论。
- 同一 Claim Store 经 LLM 重新分类可能产生运行间波动；已观察到 45 → 42 Relations。本次基线以 graphFingerprint、builtAt、model、promptVersion、relationPolicyVersion 和 temperature 锁定。
- Snapshot 包含相对文件路径，生成 JSON 默认不提交 Git。
