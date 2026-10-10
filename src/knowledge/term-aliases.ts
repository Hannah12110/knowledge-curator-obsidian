export interface TermAliasGroup {
  id: string;
  terms: string[];
}

// This intentionally small, domain-general vocabulary supports retrieval query
// expansion. It is not a translation system and contains no file/case names.
export const CLAIM_TERM_ALIASES: TermAliasGroup[] = [
  { id: "long-term-memory", terms: ["long-term memory", "long term memory", "长期记忆", "长时记忆"] },
  { id: "short-term-memory", terms: ["short-term memory", "short term memory", "短期记忆", "短时记忆"] },
  { id: "episodic-memory", terms: ["episodic memory", "情景记忆", "情节记忆"] },
  { id: "semantic-memory", terms: ["semantic memory", "语义记忆"] },
  { id: "memory-duration-taxonomy", terms: ["short term and long term", "short-term and long-term", "short term long term", "短期记忆和长期记忆", "短期记忆 长期记忆"] },
  { id: "persistent-storage", terms: ["persistent storage", "persistence", "persist", "持久化", "持久存储"] },
  { id: "context-window", terms: ["context window", "上下文窗口"] },
  { id: "retrieval-augmented-generation", terms: ["rag", "retrieval augmented generation", "检索增强生成"] },
  { id: "knowledge-graph", terms: ["knowledge graph", "知识图谱"] },
  { id: "benchmark", terms: ["benchmark", "基准测试", "基准评测"] },
  { id: "evaluation", terms: ["evaluation", "evaluate", "评测", "评价", "评估"] },
  { id: "hallucination", terms: ["hallucination", "幻觉"] },
  { id: "reinforcement-learning", terms: ["reinforcement learning", "强化学习"] },
  { id: "chain-of-thought", terms: ["chain of thought", "思维链"] },
  { id: "agent-memory", terms: ["agent memory", "智能体记忆", "代理记忆"] },
  { id: "agent-framework", terms: ["agent framework", "agent runtime", "智能体框架", "智能体运行时"] },
  { id: "orchestration", terms: ["orchestration", "workflow orchestration", "编排", "工作流编排"] },
  { id: "feedback-loop", terms: ["feedback loop", "反馈循环", "反馈闭环"] },
  { id: "tool-calling", terms: ["tool calling", "function calling", "工具调用", "函数调用"] },
  { id: "factual-accuracy", terms: ["factual accuracy", "factual grounding", "事实准确性", "事实依据"] },
  { id: "human-in-the-loop", terms: ["human in the loop", "human-in-the-loop", "人在回路", "人工审核"] }
];
