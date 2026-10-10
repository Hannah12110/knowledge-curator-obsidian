export const CLAIM_GRAPH_RELATION_POLICY_V1 = "claim-graph-relations-v1" as const;
export const CLAIM_GRAPH_RELATION_POLICY_V2 = "claim-graph-relations-v2" as const;
export const CLAIM_GRAPH_RELATION_POLICY_V3 = "claim-graph-relations-v3" as const;
export const CLAIM_GRAPH_RELATION_POLICY_V4 = "claim-graph-relations-v4" as const;
export const CLAIM_GRAPH_RELATION_POLICY_V5 = "claim-graph-relations-v5" as const;
export const CLAIM_GRAPH_RELATION_PROMPT_V2 = "claim-graph-relation-prompt-v2" as const;
export const CLAIM_GRAPH_RELATION_PROMPT_V3 = "claim-graph-relation-prompt-v3" as const;
export const CLAIM_GRAPH_RELATION_PROMPT_V4 = "claim-graph-relation-prompt-v4" as const;
export const CLAIM_GRAPH_RELATION_PROMPT_V5 = "claim-graph-relation-prompt-v5" as const;
export const CLAIM_GRAPH_RELATION_PROMPT_V6 = "claim-graph-relation-prompt-v6" as const;

export const RELATION_POLICY_V5_INSTRUCTIONS = [
  "冻结 Prompt v5 的 semanticDelta、deterministic duplicate eligibility、semantic role 与 deterministic direction 架构；本版只校准 non-duplicate relation existence 和 relation bridge。",
  "对于 duplicateEligible=false 的 pair，先独立判断 proposition-level relation 是否存在，再判断具体 relation type。不是严格逻辑蕴含，不等于 unrelated。",
  "relationBridge 只能是 evidence、reason、semantic_detail、prerequisite、contradiction、none、uncertain。",
  "RELATED：存在 evidence、reason、semantic_detail、prerequisite 或 contradiction bridge。UNRELATED：没有命题级 bridge，仅同 topic/entity/source/type、并列事实、兄弟组件或独立指标。",
  "evidence：观察、数据、核查结果或经验事实使另一命题更可信；不要求单独证明全部结论。",
  "reason：失败模式、现实约束、问题现象或动因使设计原则/处置建议更合理；部分理由也可 supports。",
  "semantic_detail：增加 scope、condition、mechanism、decomposition、implementation、quantitative specification 或 subcomponent，通常 refines。",
  "机制若解释上层判断为何合理而不改变其语义边界，使用 supports；机制若成为目标命题新增的定义或实现内容，使用 refines。",
  "若确定存在关系但 supports/refines 等具体类型不确定，relationExistence=related、relation=uncertain；不得退回 unrelated。",
  "relationExistence=unrelated 只能搭配 relation=none 与 relationBridge=none；relationExistence=uncertain 搭配 relation=uncertain 与 relationBridge=uncertain。",
  "duplicate 由冻结的 eligibility gate 单独处理：relationExistence=related、relation=duplicate、relationBridge=none。",
  "Duplicate gate、角色字段与方向映射规则完全沿用 Prompt v5，不得放宽或重新定义。"
] as const;

export const RELATION_POLICY_V4_INSTRUCTIONS = [
  "先提取语义差异，再分类非重复关系，最后只分配语义角色；不要直接输出方向。",
  "Stage 0：sameCoreProposition 判断核心主谓命题是否相同；分别列出 A/B 独有知识，并逐项标记 qualifier、scope、epistemicStrength、number、time、mechanism、scenario、condition、implementationDetail 不对称。",
  "duplicate 不是模型自由选择：只有核心命题相同、双方均无独有信息、所有不对称均为 false，且删除任一 Claim 不损失知识时才有资格。否则禁止 duplicate。",
  "非 duplicate 关系：supports 增强另一命题可信度；refines 增加范围、条件、机制、分解、实现或数值内容；contradicts 是同 scope 命题不可同时为真；depends_on 仅明确 prerequisite；否则 none。",
  "supports 与 refines：证据、原因、观察使结论更可信是 supports；增加命题本身的语义内容是 refines。",
  "相同 topic、entity、source 或 type 不足以建立关系；并列事实输出 none。",
  "方向由运行时根据角色确定。supports 只填 supportingClaim/supportedClaim；refines 只填 detailClaim/baseClaim；depends_on 只填 dependentClaim/prerequisiteClaim。角色只能 A、B、uncertain。",
  "若无法可靠区分角色，填 uncertain；不得猜方向。duplicate、contradicts、none 不分配角色。",
  "只输出结构化 JSON 和不超过80字短理由，不输出隐藏思维过程，不引入外部事实。"
] as const;

export const RELATION_POLICY_V3_INSTRUCTIONS = [
  "严格按 decision scaffold 判断，但最终只输出结构化字段和短理由，不输出隐藏思维过程。",
  "Stage 0 comparability：仅判断两条原子 Claim 本身；不得引入外部事实或第三条 Claim。",
  "Stage 1 relation existence：先判断 proposition-level relationship 是否存在。semantic equivalence、evidence/reason、semantic detail、incompatibility、prerequisite 任一明确存在则 RELATED；否则 UNRELATED；证据接近边界可标 UNCERTAIN 并输出 none。",
  "同 topic/entity/source/type 本身不足以 RELATED；并列事实、并列指标、体系内不同组成部分若无直接命题联系，必须 UNRELATED。",
  "不要把 RELATED 限制为逻辑蕴含：原因、问题现象、经验观察、现实约束、机制、组成、实现、限制条件或定量实例，只要直接使另一命题更可信或更具体，就存在关系。",
  "Stage 2 duplicate 使用 asymmetry-first：分别检查 A 独有信息与 B 独有信息。scope、polarity、epistemic strength、modality、qualifier、subject/object、causal direction、comparison target、time、number、condition 任一重要不对称都禁止 duplicate。宁可漏掉 duplicate，不能过度合并。",
  "尤其注意 epistemic asymmetry：X 未被证实、证据不足以确认 X 或 Y、X 不成立、无法判断 X、X/Y 均缺乏证据不是天然等价。只有双向核心命题等价且无重要独有信息才是 duplicate。",
  "Stage 3 contradicts：subject 与 applicable scope 一致，且 proposition 无法同时为真；不同 scope、证据不足或强弱措辞差异不自动构成冲突。",
  "Stage 4 depends_on：仅明确 prerequisite dependency。一般上下游、主题邻近或同一体系不同部分不是 depends_on。",
  "Stage 5 semantic-content test：若 source 为 target 增加 definition、scope、condition、mechanism、decomposition、component、implementation、operational detail 或 quantitative specification，选 refines。",
  "Stage 6 evidential-strength test：仅当未增加 target 的语义边界，而 source 提供证据、观察、问题现象、动因、因果理由或现实约束，使 target 更可信/合理，选 supports。",
  "反例一：随机 Benchmark 普通样本多而风险样本少 supports Benchmark 应持续吸收系统失败；前者解释必要性，没有展开应吸收哪些失败。",
  "反例二：Benchmark 是失败历史的记忆；吸收 bad case、灰度失败、争议样本与评估器误判 refines 前者，因为展开失败历史的内容。",
  "最后才判断方向，沿用 source -> target/base：证据/原因 -> 结论；更具体 Claim -> 一般 base；依赖方 -> prerequisite。left_to_right=left->right，right_to_left=right->left。",
  "duplicate、contradicts、none 必须 symmetric；supports、refines、depends_on 必须明确方向。"
] as const;

export const RELATION_POLICY_V2_INSTRUCTIONS = [
  "先完成 Stage 1 relation classification，再完成 Stage 2 direction decision；最终只输出结构化 JSON，不输出思维过程。",
  "duplicate 采用高精度策略：核心 proposition、subject/predicate、scope 与 qualifier 均等价，删除任一 Claim 不损失独立知识。任何时间、唯一性、当前性、数值、场景、因果、机制、实施细节或约束增量都排除 duplicate，优先考虑 refines。",
  "supports 表示 source Claim 提供证据、原因、观察、经验结果、因果依据或动机，使 target Claim 更可信；删除 source 后 target 含义仍完整，但论证力度下降。",
  "refines 表示 source Claim 为 target Claim 增加 scope、condition、mechanism、decomposition、implementation detail、subcomponent、operationalization 或 quantitative specification；删除 source 后 target 仍成立，但会失去语义内容。",
  "区分 supports/refines：增强可信度选 supports；增加定义、范围、机制或实现内容选 refines。",
  "contradicts 仅用于 subject 与 applicable scope 一致且 proposition 无法同时为真；不同观点、不确定或证据不足不等于冲突。",
  "depends_on 仅用于明确 prerequisite dependency。X depends_on Y 表示理解、执行或成立 X 需要 Y 作为前提。一般上下游或主题邻近不构成 depends_on。",
  "unrelated/none：相同 topic、source、entity 或 claim type 不足以建立关系；必须存在 proposition-level semantic relation。并列事实默认 none。",
  "Stage 2 方向约定：X -> Y 表示 X 是 supporting/refining/dependency-side Claim，Y 是被 support/refine 或作为依赖目标的 target/base Claim。",
  "supports：证据/原因/观察 -> 被支撑的结论。refines：更具体、增加信息的 Claim -> 更一般的 base Claim。depends_on：依赖方 -> prerequisite。",
  "left_to_right 表示 left -> right；right_to_left 表示 right -> left。duplicate、contradicts、none 必须 symmetric；supports、refines、depends_on 不得 symmetric。",
  "反例：A=Benchmark 是失败历史的记忆，B=Benchmark 应吸收 bad case、灰度失败和评估器误判，则 B refines A，即 right_to_left。",
  "反例：A=Benchmark 应持续吸收失败历史，B=随机 Benchmark 边界样本太少，则 B supports A，即 right_to_left。"
] as const;

export const RELATION_POLICY_V1_INSTRUCTIONS = [
  "关系：duplicate=核心命题等价；supports=一方提供独立支持；refines=一方增加边界或精度；contradicts=同一命题结论冲突；depends_on=一方成立依赖另一方；none=无可靠关系。",
  "方向：left_to_right 表示 left 对 right 具有该关系；right_to_left 相反；duplicate/contradicts 通常 symmetric。",
  "不要因主题相同就建立关系；证据不足输出 none。"
] as const;
