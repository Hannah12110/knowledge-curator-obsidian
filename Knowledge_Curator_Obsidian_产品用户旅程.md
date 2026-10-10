# Knowledge Curator for Obsidian｜产品用户旅程

## 1. 产品定位

该产品不是一个普通的 Obsidian AI 聊天插件，而是一个面向长期个人知识管理的 **Knowledge Curator Agent**。

核心目标不是“帮助用户保存更多内容”，而是：

> 把不断涌入的信息，筛选成少量、高质量、可持续更新的个人知识。

产品核心理念：

- 收藏 ≠ 知识准入
- Source ≠ Knowledge
- 新信息只有在能够提升现有知识体系时，才有资格长期存在
- 结构化知识应当持续更新、常看常新
- Raw 原文弱化存在感，只保留真正高质量、值得回看的来源
- 知识库的目标不是越来越大，而是越来越准、越来越精

---

## 2. 用户旅程总览

```text
发现值得看的内容
        ↓
使用 Obsidian Web Clipper 收藏
        ↓
进入 Knowledge Inbox
        ↓
Agent 判断：
质量 / 重复 / 冲突 / 增益
        ↓
必要时联网搜索权威来源交叉验证
        ↓
给出知识变更建议
        ↓
用户审核 Knowledge PR
        ↓
更新 Wiki / 保留 Raw / Reject
        ↓
持续监测知识过时、冲突、冗余
        ↓
Wiki 常看常新
```

整个产品不围绕“Chat”展开，而围绕以下知识生命周期展开：

> 捕获 → 准入 → 比较 → 验证 → 更新 → 审核 → 使用 → 维护 → 压缩

---

# 3. Journey A：新增知识摄入

## 3.1 阶段一：发现与捕获

### 用户目标

快速保存可能有价值的信息，不打断当前阅读过程。

### 用户行为

用户在以下渠道发现内容：

- 微信公众号
- X / Twitter
- Medium
- 技术博客
- GitHub
- 产品文章
- 公司博客
- 论文
- 行业报告

随后通过 Obsidian Web Clipper 保存。

### 系统行为

文章不直接进入 Raw，而是进入：

```text
00-inbox/
```

### 核心产品原则

此时用户表达的只是：

> “这篇内容可能有价值。”

而不是：

> “这篇内容已经被我确认是高质量知识。”

因此：

> 收藏 ≠ 知识准入。

---

## 3.2 阶段二：Knowledge Inbox 准入判断

用户打开 Obsidian，在插件侧边栏看到：

```text
Knowledge Agent

Inbox                 5
Needs Review          2
Conflicts             1
Stale                 8
```

点击 Inbox 后看到：

```text
New Sources

How We Built Memory for AI Agents
Anthropic Blog

待分析
```

用户点击：

```text
Analyze
```

也可以在后续版本中支持自动分析。

---

## 3.3 Agent 进行来源质量评估

Agent 判断：

- 作者 / 机构是否可信
- 是否属于一手来源
- 是否有数据、实验、代码、引用
- 是否可能已经过时
- 是否存在明显营销倾向
- 是否可验证或复现

输出示例：

```text
Source Quality: A
Topic: Agent Memory
```

来源质量不直接决定整篇文章是否可信，而只是作为后续 Claim 判断的重要依据。

---

## 3.4 Agent 检索已有知识

系统搜索：

```text
wiki/
claims/
raw/
```

找到相关内容，例如：

```text
[[Agent Memory]]
[[Long-term Memory]]
[[Context Engineering]]
```

并判断：

```text
Existing Knowledge Overlap: 76%
```

---

## 3.5 Agent 判断知识增益

系统不只判断“是不是重复”，而是计算：

> Marginal Knowledge Gain

即：

> 这篇文章相对于现有知识体系，新增了什么？

可能的新增价值包括：

- 新概念
- 新事实
- 新证据
- 新案例
- 新失败模式
- 新限制条件
- 新反方观点
- 更新的数据
- 更高质量来源

示例：

```text
Knowledge Gain: Medium

新增：
+ 2 个新的实现模式
+ 1 个 failure case
+ 1 个 2026 年 benchmark
```

---

# 4. 重复内容处理

## 4.1 情况 A：高度重复且没有增益

例如：

```text
Overlap: 91%
Knowledge Gain: Very Low
```

系统发现该文章已经被更高质量来源覆盖：

```text
Canonical Source:
- Anthropic Official Docs

Existing Supporting Source:
- Agent Memory Paper
```

并判断：

```text
本篇未发现明显新增事实、证据或案例。
```

建议操作：

```text
REJECT
```

结果：

- 不进入 Raw
- 不更新 Wiki
- 保留最小化的拒绝记录即可

核心价值：

> AI 帮助用户减少信息，而不是制造更多信息。

---

## 4.2 情况 B：高度重复，但存在增量

例如：

```text
Overlap: 80%
Knowledge Gain: Medium
```

文章大部分内容已经存在，但新增：

```text
+ 1 个新的 failure mode
+ 2 个工程实践案例
```

系统建议：

```text
EXTRACT ONLY
```

结果：

- 提取新增 Claim
- 更新 Wiki
- 原文不进入 Raw
- 不重复保存低价值内容

最终：

```text
Raw：不保留

Wiki：
更新 [[Agent Memory]]

Claim：
新增 3 条
```

---

## 4.3 情况 C：新来源质量更高

如果新文章：

- 信息与旧来源高度重叠
- 但来源更权威
- 更完整
- 更新
- 更适合作为长期参考

系统可以建议：

```text
REPLACE CANONICAL SOURCE
```

即：

```text
旧 Source B
        ↓
被 Source A 替代
```

而不是：

```text
Source A + Source B 永久共存
```

从而控制 Raw 的长期规模。

---

# 5. 冲突处理

## 5.1 发现冲突

例如现有 Wiki：

```text
Agent Memory 通常分为：
Working / Episodic / Semantic Memory。
```

新文章提出：

```text
当前 Agent Memory 更常按照
Short-term / Long-term 进行工程架构划分。
```

系统识别：

```text
CONFLICT
```

然后进入：

```text
Verification Mode
```

---

## 5.2 判断冲突类型

系统首先判断是否属于：

- 时间差异
- 定义口径不同
- 实验环境不同
- 应用场景不同
- 数据集不同
- 来源错误
- 真正观点分歧

避免把“条件不同”误判成“事实冲突”。

---

## 5.3 自动搜索外部权威来源

Agent 自动搜索：

```text
Official Documentation
Original Paper
Official GitHub Repository
Research Paper
Reliable Engineering Blog
```

并基于 Source Policy 判断来源优先级。

---

## 5.4 冲突处理结果

### 结果 A：旧知识已经过时

```text
SUPERSEDE
```

新知识替代旧知识。

旧知识进入历史状态，不继续占用 Wiki 正文。

---

### 结果 B：两种说法适用条件不同

例如：

```text
旧知识：理论分类
新知识：工程实现分类
```

则执行：

```text
REFINE
```

Wiki 更新为：

```text
Agent Memory 存在至少两种常见分类维度：

理论维度：
...

工程实现维度：
...
```

这类冲突实际上会带来更高质量的知识结构。

---

### 结果 C：无法确定哪一方更可靠

系统标记：

```text
UNRESOLVED CONFLICT
```

并在 Wiki 明确写出：

```text
目前存在两种主要观点。

观点 A：
...

来源：
...

观点 B：
...

来源：
...

当前尚无足够证据确定哪一种更准确。
```

核心原则：

> 无法解决的冲突必须被显式保留，而不是被模型强行总结成唯一答案。

---

# 6. Journey 核心触点：Knowledge PR

Agent 不应该无痕修改用户知识库。

所有重要知识变更都应生成：

> Knowledge Pull Request

示例：

```text
Knowledge Update

Source
How We Built Agent Memory

──────────────────

[[Agent Memory]]

Current

- Agent memory generally consists of
  working memory, episodic memory
  and semantic memory.

Proposed

+ Agent memory has no universally
  accepted taxonomy.

+ Common classifications include:
  theoretical classification...
  implementation classification...

Reason

New official documentation and
research provide a more precise
classification.

Evidence

✓ Official docs
✓ Research paper
✓ Existing source

Confidence
High
```

用户可以选择：

```text
[Accept All]

[Review Each]

[Reject]
```

---

# 7. 用户确认后的系统行为

用户点击 Accept 后，系统后台执行：

```text
Wiki
↓
更新

Claims
↓
新增 / 修改 / Deprecated

Source Registry
↓
更新

Raw
↓
保留 / 不保留 / Replace

History
↓
记录 Knowledge Change
```

用户最终看到：

```text
Knowledge Updated

Wiki updated           1
Claims added           2
Claims refined         1
Raw retained           No
Old claim deprecated   1
```

---

# 8. Journey B：知识使用

## 8.1 用户真正阅读的是 Wiki

用户主要阅读：

```text
wiki/
```

而不是：

```text
raw/
claims/
```

例如：

```md
# Agent Memory

## 核心概念

...

## 常见架构

...

## 适用场景

...

## 典型问题

...

## 当前争议

...

## 相关知识

[[Context Engineering]]
[[Long-term Memory]]
```

Wiki 应满足：

- 简洁
- 高密度
- 结构化
- 可重复阅读
- 可持续更新
- 能够追溯来源
- 不堆积重复内容

---

## 8.2 Raw 弱化存在感

Raw 只在以下情况下需要打开：

- 查看完整上下文
- 回看实验细节
- 回溯原始表述
- 重新阅读经典文章
- 核对证据

Raw 不应该成为用户日常浏览入口。

推荐阅读层级：

```text
                使用频率

Wiki            ████████████████████

Claims          █████

Raw             ██

Archive         ▏
```

---

# 9. Journey C：知识长期维护

## 9.1 发现过时知识

例如：

```text
[[Agent Memory]]

last_verified:
2026-05-12

freshness:
fast
```

超过 Review Interval 后：

```text
Stale Knowledge
```

侧边栏展示：

```text
Knowledge Health

Healthy          184
Needs Review      12
Stale              7
Conflicting        3
```

---

## 9.2 用户查看 Stale Knowledge

例如：

```text
Agent Memory

Last verified:
131 days ago

Change speed:
Fast

Reason:
Multiple authoritative sources may have changed.
```

提供操作：

```text
[Check for Updates]
```

---

## 9.3 Agent 执行外部更新检查

```text
搜索权威来源
        ↓
比较现有 Claims
        ↓
判断是否发生变化
```

如果没有变化：

```text
Still Valid
last_verified: 2026-09-21
```

如果发生变化：

```text
生成新的 Knowledge PR
```

然后进入用户审核。

---

# 10. Journey D：Knowledge Compression

即使每次都只吸收增量知识，Wiki 长期仍可能膨胀。

因此 Agent 需要主动寻找：

- 重复观点
- 重复案例
- 已失效知识
- 低价值细节
- 被更完整框架覆盖的旧内容
- 可以抽象成更高层方法论的碎片知识

---

## 10.1 用户收到压缩提醒

```text
Compression Opportunity

[[Agent Memory]]

Current:
6,482 words

Detected:
- 4 duplicated explanations
- 3 outdated cases
- 2 overlapping frameworks
```

用户点击：

```text
Compress
```

---

## 10.2 Agent 生成压缩 Knowledge PR

例如：

```text
Before:
6482 words

After:
4017 words

Knowledge loss:
None detected
```

具体建议：

```text
合并：
A + B + C

删除：
过时案例 X

保留：
Canonical Case Y
```

核心目标：

> 阅读越多，不意味着知识库一定越大。

理想结果甚至可能是：

```text
阅读了 20 篇文章
        ↓
Wiki 从 5000 字压缩为 3500 字
        ↓
知识质量反而更高
```

---

# 11. 三条核心用户旅程

## 11.1 Journey A：新增知识

```text
发现文章
→ Clip
→ Inbox
→ Source Quality
→ Duplicate Detection
→ Knowledge Gain
→ Conflict Detection
→ External Verification
→ Knowledge PR
→ Merge
```

这是 MVP 最核心的用户旅程。

---

## 11.2 Journey B：已有知识维护

```text
Wiki
→ Freshness Check
→ Stale
→ Web Research
→ Compare
→ Knowledge PR
→ Update
```

这是产品长期价值的重要组成部分。

---

## 11.3 Journey C：知识瘦身

```text
知识不断增长
→ Duplicate / Low-value Detection
→ Canonicalization
→ Compression
→ Replace Source
→ Archive / Remove
```

这是避免信息爆炸的关键机制。

---

# 12. User Journey Map

| 阶段 | 用户目标 | 用户行为 | Agent 行为 | 输出 |
|---|---|---|---|---|
| Discover | 保存可能有价值的信息 | Web Clipper | 暂不判断 | Inbox Source |
| Triage | 判断值不值得留 | Analyze | Source Quality / Topic | Source Assessment |
| Compare | 判断有没有新增信息 | 查看分析 | 检索现有知识 | Overlap + Knowledge Gain |
| Deduplicate | 避免重复堆积 | 查看推荐 | 比较 Canonical Source | Reject / Extract / Replace |
| Verify | 解决冲突 | 查看验证结果 | Web Search + Cross Validation | Evidence Report |
| Review | 确认知识修改 | Accept / Reject | Generate Diff | Knowledge PR |
| Merge | 更新知识体系 | 确认修改 | Update Wiki / Claim / Source | Current Knowledge |
| Learn | 使用知识 | 阅读 Wiki | Maintain Links | Updated Wiki |
| Maintain | 防止知识过时 | Review Stale | Search + Verify | Update PR |
| Compress | 防止信息爆炸 | Review Suggestion | Merge / Remove / Abstract | Lean Knowledge |

---

# 13. 核心 Aha Moments

## 13.1 Aha 1：系统主动告诉用户“不用收藏”

例如：

```text
这篇文章与现有知识重合 91%，
且没有发现明显新增信息。

已有来源质量更高。

建议：
不保留。
```

用户第一次感受到：

> AI 在帮助自己减少信息，而不是制造更多信息。

---

## 13.2 Aha 2：系统主动发现知识已经过时

例如：

```text
这篇文章与你现有知识存在冲突。

已检查：
- 官方文档
- 原始论文
- 官方代码仓库

判断：
旧知识已经过时。

建议：
SUPERSEDE
```

用户开始建立对 Agent 的信任。

---

## 13.3 Aha 3：半年后知识仍然是新的

用户几个月没有重新整理某个主题。

再次打开：

```text
Agent Memory.md
```

发现其中内容已经根据最新可靠来源完成更新，同时仍然保持简洁。

用户感受到：

> 我的知识库不是静态收藏夹，而是在持续维护我的当前认知。

---

# 14. 产品最终体验目标

理想情况下，用户不应该觉得：

> “我的 Obsidian 里多了一个 AI。”

而应该觉得：

> “我只需要继续阅读和学习，剩下的知识治理由系统持续维护。”

系统最终负责：

- 哪些文章值得保留
- 哪些内容已经重复
- 哪些新内容真正有增益
- 哪些知识存在冲突
- 哪些知识已经过时
- 哪些来源应该被替代
- 哪些 Wiki 应该压缩
- 哪些知识应该继续存在

产品长期目标：

> 用尽可能少的信息，维持尽可能准确、完整、最新的个人知识状态。
