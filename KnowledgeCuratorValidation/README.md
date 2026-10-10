# Knowledge Curator Validation

这是本地隔离的评测工作区，不属于 Obsidian Vault，也不参与知识正文。

## Public artifacts

- `FINAL_RELEASE_CHECKLIST.md`
- `reports/phase7-final-release-decision.md`
- `reports/final-closeout-verification.md`
- `reports/portfolio-summary.md`
- `reports/interview-story.md`
- `reports/demo-script-v0.1.0.md`
- `reports/architecture-summary-v0.1.0.md`

## Private / local-only artifacts

- `calibration/`：真实模型 replay、原始预测和错误样本
- `datasets/graph-quality/`：人工 Ground Truth 和 Claim statement
- `snapshot/`、`snapshots/`：真实 Vault 路径哈希与冻结 Graph
- 其他 `reports/`：可能包含真实 Claim、文件路径或运行遥测

这些目录保留在本地，但通过 `.gitignore` 排除。不要用 `git add -f` 绕过边界。

Snapshot、Review 和 Evaluation 命令默认只读 Vault Markdown；所有知识写入仍必须走 Knowledge PR、Human Review 和 Write Guard。

运行：

```bash
npm run benchmark:vault -- --vault /absolute/path/to/vault
```

也可以在未提交的 `.env.local` 中设置 `TEST_VAULT` 后直接运行：

```bash
npm run benchmark:vault
```
