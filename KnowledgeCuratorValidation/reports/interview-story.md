# Knowledge Curator — 3–5 分钟面试讲述

## 背景

我在长期维护 Obsidian 知识库时发现，真正的问题不是如何继续收集文章，而是新内容进来后，知识库会逐渐出现重复、冲突、过时和来源质量不一致。直接让大模型总结或改写 Wiki，又会带来误写和不可追溯的问题。

## 问题

我把核心问题定义为：如何判断一条新知识到底是新增、已有、补充还是冲突，并且让任何修改都可验证、可审核、可回滚。

## 我的设计

我把治理单元从文档下沉到 Claim。系统先抽取 Candidate Claim，再从 Wiki-derived Claim Store 召回已有 Claim，判断 ADD、REINFORCE、REFINE 或 CHALLENGE。冲突才调用 Tavily 搜索外部证据，再由 DeepSeek 做交叉验证。最终不直接写 Wiki，而是生成 Knowledge PR，让用户查看 Diff 后 Accept 或 Reject。

Markdown 一直是 Source of Truth；Claim Store、Freshness Store 和 Claim Graph 都只是本地派生索引。Production Preview 永远只读，测试写入也有固定 scope、mtime/hash stale 校验和写后回读。

## 最大难点

最大难点不是“能不能建图”，而是 Claim Relation 能不能安全支持后续自动化。真实数据里，supports 和 refines 很容易混淆，方向也会反转，topic 相同还可能被误判为 related。

## 如何评估

我冻结了真实 Vault 的 184 个 Claims 和 43 条 Graph Edge，对 43 条 Edge 做全量人工标注，并审核了 13 条 unrelated 样本。然后用同一批 Human Ground Truth 比较 DeepSeek Flash 与 v4-pro，而不是让模型给自己打分。

Flash 的 Edge Precision 是 93.0%，Relation Accuracy 72.1%，Direction Accuracy 93.5%；v4-pro 的 Edge Precision 同样是 93.0%，Relation Accuracy 69.8%，Direction Accuracy 86.7%。两个模型都没有通过全部自主关系门槛。

## 一次失败与迭代

早期 Graph 看起来边很多，但人工审核后 Relation Accuracy 只有 53.5%，Direction Accuracy 31.8%。我没有继续堆 Prompt，而是先统一方向定义、拆分 relation existence 与 relation type、建立错误分类，再做 frozen replay 和 model choice。指标有改善，但 supports/refines 和 related/unrelated 边界仍然跨模型存在。

## 最终 Trade-off

最后我把结果定性为 `MODEL_INDEPENDENT_LIMITATION`，没有为了“功能完整”开放自动压缩。Claim Graph 被正式定位为 AI-assisted Relation Suggestion Layer；自动 merge、delete 和 rewrite 被质量门禁关闭。

这个项目最重要的产品结论是：AI 可以提出知识关系和更新建议，但只有证据、评测和人工决策共同满足门槛时，系统才获得写入权限。最终 MVP 可以发布和演示，但高风险自动化明确不开放。

这个项目对我最大的启发是，AI 产品不是把所有模型能力都上线，而是需要通过评测和 Release Gate，明确哪些能力适合自动化，哪些能力必须保留 Human-in-the-loop。
