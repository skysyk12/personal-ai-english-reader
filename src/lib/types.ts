import type { Book, LearningRoleRow } from "@/db/schema";

export type LearningRole = Omit<
  LearningRoleRow,
  "focusAreasJson" | "featureFlagsJson"
> & {
  focusAreas: string[];
  featureFlags: {
    includeExamTips?: boolean;
    includePronunciation?: boolean;
    includeExamples?: boolean;
    includeCollocations?: boolean;
    includeGrammar?: boolean;
  };
};

export type BookSummary = Book & {
  progress: number;
  epubCfi?: string | null;
  noteCount: number;
};

export type ReaderAnchor =
  | { type: "epub"; cfiRange: string }
  | { type: "pdf"; page: number; textQuote: string };

export type ReaderSelection = {
  selectedText: string;
  current: string;
  previous: string;
  next: string;
  anchor: ReaderAnchor;
  sourceKey: string;
};

export type AiAction = "explain" | "translate" | "grammar" | "custom";

export function deserializeRole(row: LearningRoleRow): LearningRole {
  return {
    ...row,
    focusAreas: JSON.parse(row.focusAreasJson) as string[],
    featureFlags: JSON.parse(row.featureFlagsJson) as LearningRole["featureFlags"],
  };
}
