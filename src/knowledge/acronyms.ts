export interface AcronymGroup {
  id: string;
  acronym: string;
  expansions: string[];
}

export const CLAIM_ACRONYMS: AcronymGroup[] = [
  { id: "rag", acronym: "rag", expansions: ["retrieval augmented generation", "检索增强生成"] },
  { id: "llm", acronym: "llm", expansions: ["large language model", "大语言模型", "大型语言模型"] },
  { id: "rl", acronym: "rl", expansions: ["reinforcement learning", "强化学习"] },
  { id: "rlhf", acronym: "rlhf", expansions: ["reinforcement learning from human feedback", "基于人类反馈的强化学习"] },
  { id: "cot", acronym: "cot", expansions: ["chain of thought", "思维链"] },
  { id: "kg", acronym: "kg", expansions: ["knowledge graph", "知识图谱"] },
  { id: "stm", acronym: "stm", expansions: ["short term memory", "short-term memory", "短期记忆"] },
  { id: "ltm", acronym: "ltm", expansions: ["long term memory", "long-term memory", "长期记忆"] },
  { id: "mcp", acronym: "mcp", expansions: ["model context protocol", "模型上下文协议"] },
  { id: "sft", acronym: "sft", expansions: ["supervised fine tuning", "supervised fine-tuning", "监督微调"] }
];
