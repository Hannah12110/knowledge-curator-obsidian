# Knowledge Curator for Obsidian — MVP 开发 Spec

## 1. 文档目的

本文档用于指导 `Knowledge Curator for Obsidian` MVP 的快速开发与上架。

MVP 的目标不是一次性实现完整的 Knowledge OS，而是优先跑通最核心的知识准入闭环：

> 用户通过 Obsidian Web Clipper 导入文章后，插件能够判断文章质量、与现有知识的重复程度、知识增益和潜在冲突；必要时进行外部验证；最终生成一个可审核的 Knowledge PR，由用户确认后更新 Wiki，并决定 Raw 是否保留。

---

## 2. 产品定位

Knowledge Curator 是一个面向长期个人知识管理的 Obsidian 插件。

它不是普通的 AI Chat 插件，也不是单纯的 RAG 搜索工具。

核心价值：

- 判断新文章是否值得进入知识库
- 避免重复文章和重复知识持续堆积
- 识别新文章与现有知识之间的冲突
- 在冲突出现时自动搜索外部高质量来源交叉验证
- 只吸收真正有增益的信息
- 通过 Knowledge PR 的方式让用户审核知识变更
- 让结构化 Wiki 持续更新，而不是静态沉淀
- 让 Raw 只保留真正值得长期回看的高质量原文

---

## 3. MVP 核心假设

MVP 只验证一个核心命题：

> 用户是否愿意让一个 Agent 在知识进入 Obsidian 之前，帮助自己判断“留什么、不留什么、更新什么”。

如果该命题成立，再扩展长期知识维护能力。

---

## 4. MVP 核心流程

```text
Obsidian Web Clipper
        ↓
     inbox/
        ↓
用户点击 Analyze
        ↓
读取当前文章
        ↓
搜索现有 Wiki / Raw
        ↓
判断：
- 来源质量
- 重复程度
- 知识增益
- 潜在冲突
        ↓
存在冲突？
   ↓          ↓
  Yes         No
   ↓
Web Search / 外部验证
   ↓
形成知识更新建议
        ↓
生成 Knowledge PR
        ↓
用户 Review
   ↓          ↓
Accept       Reject
   ↓
更新 Wiki
决定 Raw 是否保留
记录 History
```

---

## 5. MVP 范围

### 5.1 P0 必须实现

#### 5.1.1 Obsidian 插件基础能力

- 插件可正常加载
- 提供侧边栏 View
- 提供 Settings 页面
- 能读取 Vault 中 Markdown
- 能写入和修改 Markdown
- 能扫描指定 Inbox 目录
- 能读取指定 Wiki / Raw 目录

#### 5.1.2 Inbox

支持指定：

```text
inbox/
```

插件展示 Inbox 中待处理文章。

每篇文章至少显示：

- 文件名
- 标题
- 状态
- Analyze 按钮

状态：

```text
pending
analyzing
analyzed
reviewed
failed
```

#### 5.1.3 Source Analysis

用户点击：

```text
Analyze
```

系统读取：

- 当前文章
- 现有相关 Wiki
- 必要的 Raw

然后通过 LLM 输出：

- Topic
- Source Quality
- Existing Knowledge Overlap
- Knowledge Gain
- Related Notes
- New Claims
- Potential Conflicts
- Recommendation
- Reason

#### 5.1.4 Existing Knowledge Retrieval

MVP 不引入向量数据库。

第一版使用：

- 标题匹配
- Frontmatter tags
- Wiki links
- Markdown heading
- 关键词匹配
- 简单文本相似度

找到：

```text
Top 5 ~ 10
```

相关知识文件。

随后把这些相关内容交给 LLM 做进一步语义判断。

#### 5.1.5 Duplicate / Gain 判断

系统必须区分“重复”和“没有知识增益”。

需要输出：

```text
overlap: 0 ~ 1

knowledge_gain:
- high
- medium
- low
- none
```

新增价值可以来自：

- 新概念
- 新事实
- 新证据
- 新案例
- 新失败模式
- 新适用条件
- 新限制
- 新反方观点
- 更新的数据
- 更权威的来源

#### 5.1.6 Recommendation

MVP 支持以下 4 个主要决策：

```text
REJECT
EXTRACT_ONLY
MERGE
REVIEW
```

定义：

- `REJECT`：文章价值低，或已被更高质量来源充分覆盖
- `EXTRACT_ONLY`：文章整体不值得长期保存，但存在少量知识增益
- `MERGE`：文章整体价值较高，存在显著新增知识
- `REVIEW`：存在高风险冲突或不确定结论，需要进一步验证或人工判断

#### 5.1.7 Knowledge PR

这是 MVP 最核心的 UI。

Agent 不直接修改 Wiki。

必须先生成：

```text
Knowledge Pull Request
```

每个 PR 至少包括：

- Target Wiki
- Before
- After
- Change Reason
- Source
- Confidence
- Evidence
- Raw Recommendation

支持：

```text
Accept
Reject
```

可选：

```text
Review Each Change
```

#### 5.1.8 Accept → Write

用户点击 `Accept` 后：

1. 更新对应 Wiki
2. 根据决策决定 Raw 是否保留
3. 写入 History
4. 更新 Inbox 状态

### 5.2 P1 应实现

#### 5.2.1 Conflict Detection

系统识别：

```text
new claim
vs
existing claim
```

是否存在语义冲突。

输出：

- New Claim
- Existing Claim
- Existing File
- Conflict Type
- Confidence

#### 5.2.2 External Verification

仅当出现 Conflict 时触发。

MVP 使用一个 Web Search Provider。

流程：

```text
Conflict
↓
Generate Search Query
↓
Search
↓
Get Evidence
↓
LLM Verification
↓
Resolved / Unresolved
```

#### 5.2.3 Conflict Result

支持：

```text
SUPERSEDE
REFINE
UNRESOLVED
```

#### 5.2.4 Raw Retention

MVP 支持：

```text
KEEP_RAW
EXTRACT_ONLY
REJECT_RAW
REPLACE_CANONICAL
```

#### 5.2.5 History

所有知识变更写入：

```text
.knowledge-agent/history/
```

至少记录：

- 时间
- Source
- Target Wiki
- Decision
- Before
- After
- Reason

---

## 6. MVP 暂不实现

以下功能明确不进入首版：

- 自动后台持续巡检
- Freshness Engine
- Stale 自动检查
- Knowledge Health Dashboard
- Knowledge Compression
- 自动 Raw 清理
- Embedding / Vector DB
- SQLite
- Neo4j
- 多 Agent
- 多用户
- 云同步
- Mobile
- 本地大模型
- 自动长期 Web Monitoring
- 完整 Claim Store
- 全局知识图谱
- 自动 Canonical Source 管理系统
- 复杂评分模型

---

## 7. 推荐目录结构

```text
vault/
│
├── inbox/
│
├── raw/
│
├── wiki/
│
└── .knowledge-agent/
    ├── history/
    ├── cache/
    └── config.json
```

---

## 8. 技术架构

```text
Obsidian Plugin
│
├── UI Layer
│   ├── Sidebar View
│   ├── Review View
│   └── Settings
│
├── Vault Layer
│   ├── File Scanner
│   ├── Markdown Reader
│   ├── Markdown Writer
│   └── History Writer
│
├── Retrieval Layer
│   ├── Keyword Search
│   ├── Frontmatter Search
│   └── Simple Similarity
│
├── Agent Layer
│   ├── Analyze Source
│   ├── Compare Knowledge
│   ├── Detect Conflict
│   ├── Verify Conflict
│   └── Generate Knowledge PR
│
├── LLM Client
│
├── Web Search Client
│
└── Decision Engine
```

---

## 9. 推荐技术栈

### 9.1 插件

```text
TypeScript
Obsidian Plugin API
esbuild
```

建议直接基于官方 `obsidian-sample-plugin` 起项目。

### 9.2 LLM

MVP 只实现：

```text
OpenAI-compatible API
```

配置项：

```text
Base URL
API Key
Model
```

### 9.3 Web Search

MVP 只接一个 Provider，例如 Tavily 或 Exa。

统一封装：

```ts
interface SearchProvider {
  search(query: string): Promise<SearchResult[]>;
}
```

---

## 10. 核心数据结构

### 10.1 SourceAnalysis

```ts
interface SourceAnalysis {
  topic: string;
  quality: "A" | "B" | "C" | "D";
  overlap: number;
  knowledgeGain: "high" | "medium" | "low" | "none";
  relatedNotes: string[];
  duplicateWith: string[];
  newClaims: Claim[];
  conflicts: Conflict[];
  recommendation: "reject" | "extract_only" | "merge" | "review";
  rawRecommendation: "keep" | "extract_only" | "reject" | "replace_canonical";
  reason: string;
}
```

### 10.2 Claim

```ts
interface Claim {
  id?: string;
  statement: string;
  type:
    | "definition"
    | "factual"
    | "causal"
    | "quantitative"
    | "methodological"
    | "experiential"
    | "predictive"
    | "opinion";
  evidence?: string;
  confidence: number;
}
```

### 10.3 Conflict

```ts
interface Conflict {
  newClaim: string;
  existingClaim: string;
  existingFile: string;
  type?: "temporal" | "definition" | "scope" | "data" | "method" | "direct";
  status: "unverified" | "resolved" | "unresolved";
  resolution?: "supersede" | "refine" | "unresolved";
  evidence?: SourceEvidence[];
}
```

### 10.4 SourceEvidence

```ts
interface SourceEvidence {
  title: string;
  url: string;
  sourceType: string;
  snippet?: string;
  authority?: string;
}
```

### 10.5 KnowledgeChange

```ts
interface KnowledgeChange {
  file: string;
  operation: "create" | "update";
  before?: string;
  after: string;
  reason: string;
  confidence?: number;
}
```

### 10.6 KnowledgePR

```ts
interface KnowledgePR {
  sourceFile: string;
  analysis: SourceAnalysis;
  changes: KnowledgeChange[];
  evidence: SourceEvidence[];
  createdAt: string;
  status: "pending" | "accepted" | "rejected";
}
```

---

## 11. Sidebar 信息架构

MVP 侧边栏只做 3 个核心页面：

### 11.1 Inbox

```text
Knowledge Agent

Inbox

Article A
Pending
[Analyze]

Article B
Analyzed
Knowledge Gain: Low
[Review]
```

### 11.2 Analysis Result

```text
Building Effective Agents

Quality
A

Overlap
76%

Knowledge Gain
Medium

Related Wiki
- Agent.md
- Workflow.md

New Claims
3

Conflicts
1

Recommendation
EXTRACT ONLY

[Generate Knowledge PR]
```

### 11.3 Knowledge PR

```text
Agent.md

Before
────────
Old paragraph...

After
────────
New paragraph...

Reason
New source adds...

Evidence
- Official Docs
- Original Paper

Confidence
High

Raw
Do not retain

[Accept]
[Reject]
```

---

## 12. LLM 调用设计

### 12.1 Analyze Prompt 输入

```text
New Source
+
Relevant Wiki Notes
+
Relevant Raw Sources
+
Knowledge Governance Rules
```

输出必须为严格 JSON。

### 12.2 Analyze Prompt 输出

```json
{
  "topic": "",
  "quality": "A",
  "overlap": 0.76,
  "knowledgeGain": "medium",
  "relatedNotes": [],
  "duplicateWith": [],
  "newClaims": [],
  "conflicts": [],
  "recommendation": "extract_only",
  "rawRecommendation": "extract_only",
  "reason": ""
}
```

### 12.3 Knowledge PR Prompt

输入：

```text
Source Analysis
+
Existing Wiki
+
Verified Evidence
```

输出：

```json
{
  "changes": [
    {
      "file": "wiki/Agent Memory.md",
      "operation": "update",
      "before": "...",
      "after": "...",
      "reason": "..."
    }
  ]
}
```

---

## 13. Retrieval 设计

MVP 不使用 Vector DB。

候选知识召回按以下优先级：

```text
1. Exact title match
2. Frontmatter tag match
3. Wiki link match
4. Heading match
5. Keyword overlap
6. Simple text similarity
```

最多取：

```text
Top 5 ~ 10
```

避免将整个 Vault 发送给模型。

---

## 14. 冲突验证设计

只有在：

```text
conflicts.length > 0
```

时触发。

步骤：

```text
1. 为每个冲突生成 Search Query
2. 搜索高质量外部来源
3. 获取 Top N evidence
4. 交给 LLM 比较
5. 返回冲突结论
```

结果：

```text
SUPERSEDE
REFINE
UNRESOLVED
```

---

## 15. Source Policy

第一版使用简单规则。

### Tier 0

- 官方文档
- 官方数据
- 原始论文
- 官方 GitHub
- 标准

### Tier 1

- 作者本人
- 核心开发者
- 研究机构
- 一手工程实践

### Tier 2

- 高质量专业技术博客
- 专业媒体
- 高质量行业分析

### Tier 3

- 普通媒体
- 聚合文章
- 社区讨论

### Tier 4

- SEO 内容
- 无法确认来源
- 明显营销内容

规则：

```text
Tier 0 存在时优先 Tier 0

Tier 0 不存在时：
至少寻找多个独立来源

仍无法判断：
UNRESOLVED
```

---

## 16. Raw 保留策略

Raw 不是收藏夹。

进入 Raw 必须满足至少一个条件：

```text
Canonical
Authoritative
Evidence-rich
Unique
Reference-worthy
Historical
```

否则优先：

```text
EXTRACT_ONLY
```

---

## 17. History 设计

建议文件：

```text
.knowledge-agent/history/YYYY-MM-DD-HHmmss.json
```

内容：

```json
{
  "source": "inbox/article.md",
  "target": "wiki/Agent Memory.md",
  "decision": "extract_only",
  "before": "...",
  "after": "...",
  "reason": "...",
  "createdAt": "..."
}
```

MVP 暂不做复杂版本恢复 UI，只保证修改可追溯。

---

## 18. Settings

MVP Settings 至少包含：

```text
Inbox Folder
Raw Folder
Wiki Folder

LLM Base URL
LLM API Key
LLM Model

Search Provider
Search API Key

Max Related Notes
```

建议默认：

```text
Max Related Notes = 8
```

---

## 19. 安全与隐私

默认原则：

> 不上传整个 Vault。

每次 LLM 请求只发送：

- 当前待分析文章
- Top N 相关 Wiki
- 必要的相关 Raw

README 和 Settings 中应明确说明：

```text
Selected note content may be sent to the configured LLM provider.

Search queries and conflict claims may be sent to the configured Web Search provider.
```

---

## 20. Obsidian 上架准备

项目根目录准备：

```text
README.md
manifest.json
main.js
styles.css
```

LICENSE 根据发布策略选择；本 v0.1.0 未声明开源许可证。

MVP 建议 Desktop-first，避免 Mobile 兼容拖慢第一版。

---

## 21. 推荐开发阶段

### Phase 0：Plugin Scaffold

目标：

- 插件加载
- Sidebar 打开
- Settings 可配置
- 能读取一个 Markdown

DoD：

```text
Obsidian 能正常加载插件
```

### Phase 1：Vault I/O

实现：

```text
scanInbox()
readFile()
listWikiFiles()
findRelevantFiles()
writeFile()
writeHistory()
```

DoD：

> 不接 AI，也能正确读写目标文件。

### Phase 2：LLM Analyze

实现：

```text
Analyze Article
```

输出：

- Quality
- Overlap
- Knowledge Gain
- New Claims
- Conflicts
- Recommendation

DoD：

> 任意一篇 Inbox 文章可以得到结构化分析结果。

### Phase 3：Knowledge PR

实现：

- Generate PR
- Before / After
- Accept / Reject

DoD：

> 用户接受后，Wiki 被正确修改。

做到这里即可开始真实用户测试。

### Phase 4：Conflict + Web Search

实现：

```text
Conflict
→ Search
→ Verify
→ Resolution
```

DoD：

> 发现冲突后能够使用外部来源进行验证并给出结果。

### Phase 5：Raw Decision

实现：

```text
KEEP_RAW
EXTRACT_ONLY
REJECT_RAW
REPLACE_CANONICAL
```

DoD：

> 一篇文章完成知识更新后，系统能决定原文是否长期保留。

### Phase 6：Release

完成：

- README
- Privacy Disclosure
- Settings 文档
- manifest
- Release
- Community Plugin Submission

---

## 22. 开发优先级

| 优先级 | 功能 |
|---|---|
| P0 | Obsidian Plugin Scaffold |
| P0 | Inbox 扫描 |
| P0 | Wiki 搜索 |
| P0 | LLM Analyze |
| P0 | Quality 判断 |
| P0 | Duplicate 判断 |
| P0 | Knowledge Gain |
| P0 | Knowledge PR |
| P0 | Accept → 修改 Markdown |
| P1 | Conflict Detection |
| P1 | Web Verification |
| P1 | Raw Retention |
| P1 | History |
| P2 | Freshness |
| P2 | Knowledge Health |
| P2 | Compression |
| P2 | Vector Retrieval |
| P2 | Local LLM |
| P2 | Mobile |

原则：

> P0 没完全跑通之前，不开发 P2。

---

## 23. MVP Definition of Done

MVP 完成标准不是：

> 做出了一个完整 Knowledge OS。

而是下面这条真实流程可以完整跑通。

用户使用 Web Clipper 保存一篇文章。

随后在 Obsidian：

```text
1. 打开 Knowledge Curator
2. 在 Inbox 找到新文章
3. 点击 Analyze
```

系统输出：

```text
Source Quality: A

Overlap: 82%

Knowledge Gain: Medium

Conflict: 1

Recommendation:
EXTRACT ONLY

Reason:
大部分内容已有更权威来源覆盖，
但新增 2 条值得进入知识库的知识。

External Verification:
已验证冲突，新来源更准确。

Wiki Changes:
Agent Memory.md

[Review Diff]
```

用户点击：

```text
Review Diff
```

看到：

```text
Before
↓
After
```

用户点击：

```text
Accept
```

最终：

```text
Wiki 更新成功
Raw 不保留
History 已记录
Inbox 状态更新为 reviewed
```

完成以上闭环，即可视为 MVP 达标。

---

## 24. MVP 成功指标

### 24.1 流程成功率

```text
文章进入 Inbox
→ 成功完成 Knowledge PR
```

目标：

```text
≥ 90%
```

### 24.2 用户认可率

记录用户是否认可：

```text
REJECT
EXTRACT_ONLY
MERGE
REVIEW
```

建议指标：

```text
Accept Recommendation Rate
```

### 24.3 Knowledge PR 接受率

```text
Accepted PR / Generated PR
```

### 24.4 Raw Reduction

观察：

```text
多少文章最终没有进入 Raw
```

用于验证“减少信息爆炸”是否成立。

### 24.5 Incremental Value

观察用户是否认为：

> 插件识别出的“新增知识”确实是现有知识库中缺失且值得保留的。

---

## 25. MVP 后续路线

### V0.2

增加：

- 更稳定的 Retrieval
- Claim Store
- Source Registry
- Canonical Source
- Duplicate Center

### V0.3

增加：

- Freshness
- Stale Check
- Knowledge Health

### V0.4

增加：

- Knowledge Compression
- Source Replacement
- 自动长期维护

### V1.0

形成完整：

> Knowledge Governance System for Obsidian

---

## 26. 最终原则

MVP 的目标不是证明：

> AI 可以帮用户整理文章。

而是证明：

> AI 可以帮助用户持续维护“什么值得成为长期知识”。

整个产品应始终围绕以下原则：

- 少保存
- 高质量
- 有增益
- 可验证
- 可更新
- 可追溯
- 可淘汰

最终追求：

> 用尽可能少的信息，维持尽可能准确、完整、最新的个人知识状态。
