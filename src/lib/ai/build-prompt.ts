import type { AiAction, LearningRole } from "@/lib/types";

const BASE_TUTOR_PROMPT = `你是一名服务于个人阅读场景的英语导师。

你的回答必须优先帮助用户理解当前阅读内容。你需要结合当前选区、所在句子和必要上下文，而不是只给出脱离语境的字典释义。

规则：
1. 先直接回答问题。
2. 区分“当前语境含义”和“其他常见含义”。
3. 不要为了显得全面而加入与当前问题无关的内容。
4. 不确定作者意图时明确说明是推测。
5. 不编造书籍背景、词源、例句来源或考试结论。
6. 保留必要的英文术语和英文例句。
7. 遵循当前学习角色的目标和输出要求。
8. 使用清晰的 Markdown，但避免复杂表格。
9. 用户要求简短时不要展开；用户追问时再逐步深入。
10. 用户在当前问题中提出的长度、格式和范围要求，优先于学习角色的默认详细程度。
11. 当用户明确要求“简短”时，默认控制在 120 个中文字符或 3 个要点以内，除非不展开会造成误解。`;

const ACTION_PROMPTS: Record<AiAction, string> = {
  explain: `请解释选中内容在当前语境中的含义。优先给出当前含义、表达类型、原句自然翻译，再补充当前学习角色真正需要的信息。`,
  translate: `请自然翻译选中的句子或段落，再解释最容易误解的表达。不要逐词机械对照。`,
  grammar: `请分析句子结构：先提取主干，再说明从句、修饰成分和关键语法，最后给出一个更简单的英文改写。`,
  summary: `请总结当前章节或页面。先用 3—5 个要点概括核心内容，再说明作者的论证或叙事推进，最后给出一段 80 字以内的中文摘要。不要补写原文中没有的信息。`,
  vocabulary: `请从当前章节、页面或选区中提取 8—12 个最值得学习的英文词汇或搭配。每项包含：原词、当前语境义、词性或表达类型、原文中的短语境、一个简洁记忆提示。避免收录过于基础或脱离语境的词。`,
  review: `请根据当前内容生成一组可执行的复习任务：3 道主动回忆题、2 道语境填空题、1 个 2 分钟复述任务。题目后折叠式给出答案或评分要点，并突出今天最值得复习的内容。`,
  custom: `请根据当前学习角色、原文和上下文回答用户的具体问题。`,
};

export function buildRolePrompt(role: LearningRole): string {
  const enabledFeatures = Object.entries(role.featureFlags)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .join(", ");

  return `${BASE_TUTOR_PROMPT}

当前学习角色：${role.name}
当前英语水平：${role.currentLevel}
学习目标：${role.goal}
重点方向：${role.focusAreas.join("、") || "语境理解"}
回答语言：${role.answerLanguage}
详细程度：${role.explanationDepth}
语气：${role.tone}
启用的补充维度：${enabledFeatures || "无"}
自定义要求：${role.customInstructions || "无"}`;
}

export type ReadingContext = {
  bookTitle: string;
  author: string;
  locationLabel?: string;
  previous: string;
  current: string;
  next: string;
  selectedText: string;
};

export function buildReadingUserPrompt(
  action: AiAction,
  context: ReadingContext,
  question?: string,
): string {
  const resolvedQuestion = question || defaultQuestion(action);
  const briefRequested = /简短|简洁|一句话|brief|concise/i.test(resolvedQuestion);
  return `${ACTION_PROMPTS[action]}

书籍：${context.bookTitle}
作者：${context.author}
位置：${context.locationLabel || "当前阅读位置"}

前文：
${context.previous || "（无）"}

当前内容：
${context.current}

后文：
${context.next || "（无）"}

用户选中：
${context.selectedText}

用户问题：
${resolvedQuestion}${briefRequested ? "\n\n输出限制：只给当前语境含义和必要的一句说明；不添加考试提示、额外例句或延伸知识。" : ""}`;
}

export function defaultQuestion(action: AiAction): string {
  if (action === "translate") return "请翻译并指出最容易误解的表达。";
  if (action === "grammar") return "请分析这句话的结构。";
  if (action === "summary") return "请总结当前章节或页面。";
  if (action === "vocabulary") return "请提取当前内容中最值得学习的生词和搭配。";
  if (action === "review") return "请为当前内容生成一组复习任务。";
  if (action === "custom") return "请结合上下文帮助我理解。";
  return "这里是什么意思？";
}
