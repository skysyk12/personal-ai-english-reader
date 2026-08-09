export type RolePreset = {
  id: string;
  name: string;
  description: string;
  currentLevel: string;
  goal: string;
  focusAreas: string[];
  answerLanguage: "zh-CN" | "en" | "bilingual";
  explanationDepth: "brief" | "standard" | "detailed";
  tone: "direct" | "teacher" | "concise";
  featureFlags: {
    includeExamTips: boolean;
    includePronunciation: boolean;
    includeExamples: boolean;
    includeCollocations: boolean;
    includeGrammar: boolean;
  };
  customInstructions: string;
  isDefault: boolean;
};

export const ROLE_PRESETS: RolePreset[] = [
  {
    id: "role_ielts",
    name: "雅思备考",
    description: "面向雅思阅读、写作和口语迁移的系统讲解。",
    currentLevel: "B1–B2",
    goal: "提升雅思阅读理解，并积累可迁移到写作和口语的表达。",
    focusAreas: ["语境含义", "常见搭配", "同义替换", "写作迁移"],
    answerLanguage: "bilingual",
    explanationDepth: "detailed",
    tone: "teacher",
    featureFlags: {
      includeExamTips: true,
      includePronunciation: true,
      includeExamples: true,
      includeCollocations: true,
      includeGrammar: true,
    },
    customInstructions: "不要对简单词汇过度展开；考试建议必须与当前表达确实相关。",
    isDefault: true,
  },
  {
    id: "role_fiction",
    name: "小说沉浸阅读",
    description: "用最少打断理解情节、语气和人物情绪。",
    currentLevel: "B1–B2",
    goal: "保持连续阅读，快速理解故事和语气。",
    focusAreas: ["自然含义", "人物语气", "文化背景"],
    answerLanguage: "zh-CN",
    explanationDepth: "brief",
    tone: "concise",
    featureFlags: {
      includeExamTips: false,
      includePronunciation: false,
      includeExamples: false,
      includeCollocations: false,
      includeGrammar: false,
    },
    customInstructions: "默认控制在三小段以内，除非用户追问。",
    isDefault: false,
  },
  {
    id: "role_academic",
    name: "学术英语阅读",
    description: "关注论证结构、正式语域、长句句法和学术搭配。",
    currentLevel: "B2–C1",
    goal: "准确理解学术论述，并积累正式英文表达。",
    focusAreas: ["句子逻辑", "学术搭配", "从句结构", "论证功能"],
    answerLanguage: "bilingual",
    explanationDepth: "detailed",
    tone: "direct",
    featureFlags: {
      includeExamTips: false,
      includePronunciation: false,
      includeExamples: true,
      includeCollocations: true,
      includeGrammar: true,
    },
    customInstructions: "先提取论述主干，再解释修饰关系与正式同义表达。",
    isDefault: false,
  },
];
