export const ENGLISH_CLAIM_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
  "has", "have", "in", "is", "it", "of", "on", "or", "that", "the",
  "this", "to", "with"
]);

export const CHINESE_CLAIM_STOP_WORDS = new Set([
  "一个", "以及", "可以", "进行", "通过", "这个", "这些", "其中",
  "并且", "或者", "但是", "因为", "所以", "对于", "需要",
  "的", "是", "和", "与", "在", "了", "为", "及"
]);

// Qualifiers are deliberately absent: always/usually/may/only/never and their
// Chinese equivalents carry relation and conflict meaning.
