import { z } from "zod";

const DateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const ShortTermSchema = z.string().trim().min(1).max(100);

export const ParsedMemoryQuerySchema = z
  .object({
    rawQuery: z.string().trim().min(1).max(500),
    dateRange: z
      .object({
        from: DateOnlySchema.nullable().default(null),
        to: DateOnlySchema.nullable().default(null),
      })
      .strict()
      .nullable()
      .default(null),
    places: z.array(ShortTermSchema).max(10).default([]),
    people: z.array(ShortTermSchema).max(10).default([]),
    activities: z.array(ShortTermSchema).max(10).default([]),
    keywords: z.array(ShortTermSchema).max(20).default([]),
    aliasesApplied: z
      .array(
        z
          .object({
            from: ShortTermSchema,
            to: ShortTermSchema,
            source: z.enum(["user_confirmed", "session"]),
          })
          .strict(),
      )
      .max(20)
      .default([]),
  })
  .strict()
  .superRefine((query, context) => {
    if (
      query.dateRange?.from !== null &&
      query.dateRange?.to !== null &&
      query.dateRange !== null &&
      query.dateRange.from! > query.dateRange.to!
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dateRange"],
        message: "dateRange.from must be on or before dateRange.to.",
      });
    }
  });

export type ParsedMemoryQuery = z.infer<typeof ParsedMemoryQuerySchema>;

export function parseMemoryQueryOutput(
  rawOutput: unknown,
  expectedRawQuery: string,
): ParsedMemoryQuery {
  const parsed = ParsedMemoryQuerySchema.parse(rawOutput);
  const expected = expectedRawQuery.trim();
  if (parsed.rawQuery !== expected) {
    throw new Error("The AI query parser changed the user's raw query.");
  }

  return {
    ...parsed,
    places: uniqueTerms(parsed.places),
    people: uniqueTerms(parsed.people),
    activities: uniqueTerms(parsed.activities),
    keywords: uniqueTerms(parsed.keywords),
    aliasesApplied: parsed.aliasesApplied.filter(
      (alias, index, aliases) =>
        aliases.findIndex(
          (other) =>
            other.from.toLocaleLowerCase() === alias.from.toLocaleLowerCase() &&
            other.to.toLocaleLowerCase() === alias.to.toLocaleLowerCase(),
        ) === index,
    ),
  };
}

export const SearchCandidateSchema = z
  .object({
    memoryId: z.string().min(1).max(200),
    status: z.enum(["draft", "active", "disputed", "deleting", "deleted"]),
    structuredScore: z.number().min(0).max(1),
    rerankScore: z.number().min(0).max(1).nullable().default(null),
    matchReasons: z
      .array(z.string().trim().min(1).max(120))
      .max(10)
      .default([]),
  })
  .strict();

export type SearchCandidate = z.infer<typeof SearchCandidateSchema>;

export type CandidateSelectionDecision =
  | {
      kind: "selected";
      candidate: SearchCandidate;
      alternatives: [];
    }
  | {
      kind: "ambiguous";
      candidate: null;
      alternatives: SearchCandidate[];
    }
  | {
      kind: "unknown";
      candidate: null;
      alternatives: [];
    };

export const CandidateGateOptionsSchema = z
  .object({
    minimumAnswerScore: z.number().min(0).max(1),
    minimumCandidateScore: z.number().min(0).max(1),
    decisiveMargin: z.number().min(0).max(1),
    ambiguityWindow: z.number().min(0).max(1),
    maxAlternatives: z.number().int().min(2).max(3),
  })
  .strict();

export type CandidateGateOptions = z.infer<typeof CandidateGateOptionsSchema>;

export function selectSearchCandidates(
  rawCandidates: readonly SearchCandidate[],
  rawOptions: Partial<CandidateGateOptions> = {},
): CandidateSelectionDecision {
  const options = CandidateGateOptionsSchema.parse({
    minimumAnswerScore: 0.68,
    minimumCandidateScore: 0.45,
    decisiveMargin: 0.12,
    ambiguityWindow: 0.1,
    maxAlternatives: 3,
    ...rawOptions,
  });
  const seen = new Set<string>();
  const candidates = rawCandidates
    .map((candidate) => SearchCandidateSchema.parse(candidate))
    .filter((candidate) => candidate.status === "active")
    .filter((candidate) => {
      if (seen.has(candidate.memoryId)) return false;
      seen.add(candidate.memoryId);
      return true;
    })
    .sort(
      (left, right) =>
        candidateScore(right) - candidateScore(left) ||
        right.structuredScore - left.structuredScore ||
        left.memoryId.localeCompare(right.memoryId),
    );

  const top = candidates[0];
  if (
    top === undefined ||
    candidateScore(top) < options.minimumCandidateScore
  ) {
    return { kind: "unknown", candidate: null, alternatives: [] };
  }

  const second = candidates[1];
  const margin =
    second === undefined
      ? Number.POSITIVE_INFINITY
      : candidateScore(top) - candidateScore(second);
  if (
    candidateScore(top) >= options.minimumAnswerScore &&
    margin >= options.decisiveMargin
  ) {
    return { kind: "selected", candidate: top, alternatives: [] };
  }

  const alternatives = candidates
    .filter(
      (candidate) =>
        candidateScore(candidate) >= options.minimumCandidateScore &&
        candidateScore(top) - candidateScore(candidate) <=
          options.ambiguityWindow,
    )
    .slice(0, options.maxAlternatives);

  return alternatives.length >= 2
    ? { kind: "ambiguous", candidate: null, alternatives }
    : { kind: "unknown", candidate: null, alternatives: [] };
}

function candidateScore(candidate: SearchCandidate): number {
  return candidate.rerankScore ?? candidate.structuredScore;
}

function uniqueTerms(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.normalize("NFKC").toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
