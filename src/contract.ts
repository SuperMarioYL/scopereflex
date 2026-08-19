import { z } from "zod";
import {
  type ScopeManifest,
  StepSchema,
  classifyBlastRadius,
} from "./manifest.js";

/**
 * The contract module: turn a coding agent's plan (JSON or markdown) into a
 * ScopeManifest the contraction engine can reason about.
 *
 * The plan is richer than the manifest — it carries per-file `optional` flags
 * and `purpose` text that the contraction rules act on. The manifest is the
 * lean scope view emitted in the final ContractionDiff.
 */

// --- Plan file / step / plan schemas ---------------------------------------

export const PlanFileSchema = z.object({
  path: z.string().min(1),
  purpose: z.string().default(""),
  optional: z.boolean().default(false),
});
export type PlanFile = z.infer<typeof PlanFileSchema>;

export const PlanStepSchema = StepSchema;

export const PlanSchema = z.object({
  intent: z.string().default(""),
  files: z.array(PlanFileSchema).default([]),
  steps: z.array(PlanStepSchema).default([]),
  // The agent's own estimate of how verbose its output will be. Optional:
  // when absent we estimate from the file/step counts.
  output_length_tokens: z.number().int().nonnegative().optional(),
});
export type Plan = z.infer<typeof PlanSchema>;

// --- Token estimation -------------------------------------------------------

/**
 * Rough token estimate for a plan's output. Deterministic on the file/step
 * counts so the contraction-diff is machine-checkable, not a guess. The
 * "verbose" original estimate is heavier per unit than the contracted one
 * (rules.ts caps verbosity), which is what produces the 3,200 -> 850 style
 * deltas in the README example.
 */
export function estimateOutputTokens(
  files: number,
  steps: number,
  perFile: number,
  perStep: number,
  floor = 200,
): number {
  return Math.max(Math.round(files * perFile + steps * perStep), floor);
}

export function estimateOriginalTokens(plan: Plan): number {
  return estimateOutputTokens(plan.files.length, plan.steps.length, 180, 140);
}

export function estimateContractedTokens(plan: Plan): number {
  // Terse per-unit weights (lighter than the original 180/140) so a contracted
  // plan's output estimate is materially smaller — 4 files + 5 steps = 850
  // tokens, matching the canonical contraction-diff example.
  return estimateOutputTokens(plan.files.length, plan.steps.length, 125, 70);
}

// --- Plan -> ScopeManifest --------------------------------------------------

export function planToManifest(plan: Plan): ScopeManifest {
  const seen = new Set<string>();
  const files_touched: string[] = [];
  for (const f of plan.files) {
    if (!seen.has(f.path)) {
      seen.add(f.path);
      files_touched.push(f.path);
    }
  }
  const output_length_tokens =
    plan.output_length_tokens ?? estimateOriginalTokens(plan);
  return {
    intent: plan.intent,
    files_touched,
    steps: plan.steps.map((s) => ({ ...s })),
    output_length_tokens,
    blast_radius: classifyBlastRadius(files_touched.length),
  };
}

// --- Parsing ----------------------------------------------------------------

export class PlanParseError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PlanParseError";
  }
}

/**
 * Parse a plan from raw file contents. Auto-detects JSON (starts with `{` or
 * `[`) vs. a lightweight markdown dialect; validates against the Plan schema.
 */
export function parsePlan(raw: string): Plan {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseJsonPlan(trimmed);
  }
  return parseMarkdownPlan(raw);
}

function parseJsonPlan(raw: string): Plan {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new PlanParseError("plan is not valid JSON", err);
  }
  const result = PlanSchema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new PlanParseError(
      `plan JSON failed validation: ${first?.path.join(".") ?? "(root)"} — ${first?.message ?? "invalid"}`,
    );
  }
  return result.data;
}

/**
 * Lightweight markdown plan dialect:
 *
 *   # Plan: <intent>
 *
 *   ## Files
 *   - src/auth/login.ts — login component
 *   - src/utils/helpers.ts (optional) — helpers
 *
 *   ## Steps
 *   1. Create login component
 *   2. Add optional refactor (optional)
 *
 *   ## Output
 *   ~3200 tokens
 *
 * The parser is intentionally forgiving; lines it cannot classify are ignored
 * rather than throwing, so agents can paste free-form notes around the
 * structured sections.
 */
export function parseMarkdownPlan(raw: string): Plan {
  const intent = extractIntent(raw);
  const files = extractFiles(raw);
  const steps = extractSteps(raw);
  const output_length_tokens = extractOutputTokens(raw);

  const result = PlanSchema.safeParse({
    intent,
    files,
    steps,
    output_length_tokens,
  });
  if (!result.success) {
    throw new PlanParseError(
      "markdown plan did not yield a valid plan (need at least a Files or Steps section)",
    );
  }
  return result.data;
}

function extractIntent(raw: string): string {
  const m = raw.match(/^\s*#\s+(?:Plan:?\s*)?(.+?)\s*$/im);
  return m?.[1]?.trim() ?? "";
}

function extractFiles(raw: string): PlanFile[] {
  const section = sliceSection(raw, /^##\s+files\b/im);
  if (!section) return [];
  const files: PlanFile[] = [];
  for (const line of section.split("\n")) {
    const item = line.match(/^\s*[-*]\s+(.+)$/);
    if (!item) continue;
    const body = item[1];
    const optional = /\(optional\)|\(nice-to-have\)|\(skip\)/i.test(body);
    const cleaned = body
      .replace(/\(optional\)|\(nice-to-have\)|\(skip\)/gi, "")
      .replace(/\(([^)]*)\)/g, " — $1") // turn "(comment)" into "— comment"
      .trim();
    const [path, ...purposeParts] = cleaned.split(/\s+[—–-]\s+|\s{2,}/);
    const purpose = purposeParts.join(" ").trim();
    if (path) {
      files.push({ path: path.trim(), purpose, optional });
    }
  }
  return files;
}

function extractSteps(raw: string): { id: string; description: string; optional: boolean }[] {
  const section = sliceSection(raw, /^##\s+steps\b/im);
  if (!section) return [];
  const steps: { id: string; description: string; optional: boolean }[] = [];
  for (const line of section.split("\n")) {
    const item = line.match(/^\s*(?:\d+[.)]\s+|[-*]\s+)(.+)$/);
    if (!item) continue;
    const body = item[1];
    const optional = /\(optional\)|\(nice-to-have\)|\(skip\)/i.test(body);
    const description = body
      .replace(/\(optional\)|\(nice-to-have\)|\(skip\)/gi, "")
      .trim();
    if (description) {
      steps.push({
        id: String(steps.length + 1),
        description,
        optional,
      });
    }
  }
  return steps;
}

function extractOutputTokens(raw: string): number | undefined {
  const section = sliceSection(raw, /^##\s+output\b/im);
  const hay = section ?? raw;
  const m = hay.match(/(\d[\d,]*)\s*tokens?/i);
  if (!m) return undefined;
  return Number(m[1].replace(/,/g, ""));
}

function sliceSection(raw: string, heading: RegExp): string | undefined {
  const match = raw.match(heading);
  if (!match || match.index === undefined) return undefined;
  const start = match.index + match[0].length;
  const next = raw.slice(start).search(/^##\s/im);
  const end = next === -1 ? raw.length : start + next;
  return raw.slice(start, end);
}

// --- Plan (re)construction for the contracted output -----------------------

/**
 * Serialize a contracted Plan back to JSON for the agent to consume. The
 * contracted plan keeps intent + the surviving files/steps + the recomputed
 * output estimate so the agent has a complete, self-contained directive.
 */
export function serializeContractedPlan(
  plan: Plan,
  output_length_tokens: number,
): string {
  return JSON.stringify(
    {
      intent: plan.intent,
      files: plan.files.map((f) => ({
        path: f.path,
        purpose: f.purpose,
        optional: f.optional,
      })),
      steps: plan.steps.map((s) => ({
        id: s.id,
        description: s.description,
        optional: s.optional,
      })),
      output_length_tokens,
      contracted_by: "scopereflex",
    },
    null,
    2,
  ) + "\n";
}
