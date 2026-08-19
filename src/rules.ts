import { type Plan, type PlanFile } from "./contract.js";
import {
  type ContractionDiff,
  type ScopeManifest,
  classifyBlastRadius,
} from "./manifest.js";
import { estimateContractedTokens } from "./contract.js";

/**
 * The contraction engine: apply deterministic rules to a coding agent's plan
 * and produce a counterfactual "do less" variant plus a structured, countable
 * diff. Rules are intentionally rule-based heuristics (not an ML model) so the
 * resulting contraction-diff is machine-checkable and auditable — every
 * removed/merged artifact carries a one-line rationale a human can review.
 *
 * Pipeline (order matters): dedup files -> merge helper files into sibling
 * index files -> drop optional files -> drop optional steps -> cap output.
 */

export interface ContractionOutcome {
  contractedPlan: Plan;
  removedFiles: string[];
  mergedFiles: string[]; // source paths that were merged into a sibling
  removedSteps: string[]; // step ids
  mergedSteps: string[]; // step ids (currently always empty — steps are dropped, not merged)
  rationale: string[];
}

// --- Deterministic rule primitives -----------------------------------------

/** Files whose path looks like a small "helper/util/common" module that a
 *  sibling `index.*` can absorb. */
const HELPER_FILE_PATTERN = /(^|\/)(helpers?|utils?|util|common|shared)\.(ts|tsx|js|jsx|mjs|cjs)$/i;
const INDEX_FILE_PATTERN = /(^|\/)index\.(ts|tsx|js|jsx|mjs|cjs)$/i;

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

/** Rule 1 — dedup: collapse duplicate file paths (keep first). */
export function dedupFiles(plan: Plan): { plan: Plan; rationale: string[]; merged: string[] } {
  const seen = new Set<string>();
  const files: PlanFile[] = [];
  const dupes: string[] = [];
  for (const f of plan.files) {
    if (seen.has(f.path)) {
      dupes.push(f.path);
    } else {
      seen.add(f.path);
      files.push(f);
    }
  }
  const rationale =
    dupes.length > 0
      ? [`deduplicated ${dupes.length} duplicate file path(s): ${dupes.join(", ")}`]
      : [];
  return { plan: { ...plan, files }, rationale, merged: dupes };
}

/** Rule 2 — merge helpers: helper/util files with a sibling index are folded in. */
export function mergeHelpers(plan: Plan): {
  plan: Plan;
  rationale: string[];
  merged: string[];
} {
  const filesByDir = new Map<string, PlanFile[]>();
  for (const f of plan.files) {
    const dir = dirname(f.path);
    const bucket = filesByDir.get(dir) ?? [];
    bucket.push(f);
    filesByDir.set(dir, bucket);
  }

  const merged: string[] = [];
  const rationale: string[] = [];
  const survivors: PlanFile[] = [];
  // Snapshot the index sibling purposes so absorption never mutates the input
  // plan's file objects (the same plan may be contracted more than once).
  const absorbedPurposes = new Map<string, string>();

  for (const f of plan.files) {
    if (!HELPER_FILE_PATTERN.test(f.path)) {
      survivors.push(f);
      continue;
    }
    const dir = dirname(f.path);
    const siblings = filesByDir.get(dir) ?? [];
    const indexSibling = siblings.find((s) => s.path !== f.path && INDEX_FILE_PATTERN.test(s.path));
    if (indexSibling) {
      merged.push(f.path);
      rationale.push(`merged ${f.path} into ${indexSibling.path}`);
      const prev = absorbedPurposes.get(indexSibling.path) ?? indexSibling.purpose;
      const combined = [prev, f.purpose].filter(Boolean).join(" + ").trim();
      absorbedPurposes.set(indexSibling.path, combined);
    } else {
      survivors.push(f);
    }
  }

  // Apply absorbed purposes to cloned index files so we never mutate inputs.
  const filesWithMerges = survivors.map((f) => {
    const absorbed = absorbedPurposes.get(f.path);
    return absorbed ? { ...f, purpose: absorbed } : f;
  });

  return { plan: { ...plan, files: filesWithMerges }, rationale, merged };
}

/** Rule 3 — drop optional files. */
export function dropOptionalFiles(plan: Plan): {
  plan: Plan;
  rationale: string[];
  removed: string[];
} {
  const removed: string[] = [];
  const rationale: string[] = [];
  const survivors: PlanFile[] = [];
  for (const f of plan.files) {
    if (f.optional) {
      removed.push(f.path);
      rationale.push(`dropped ${f.path} (optional, not on critical path)`);
    } else {
      survivors.push(f);
    }
  }
  return { plan: { ...plan, files: survivors }, rationale, removed };
}

/** Rule 4 — drop optional steps. */
export function dropOptionalSteps(plan: Plan): {
  plan: Plan;
  rationale: string[];
  removed: string[];
} {
  const removed: string[] = [];
  const rationale: string[] = [];
  const survivors = plan.steps.filter((s) => {
    if (s.optional) {
      removed.push(s.id);
      rationale.push(`dropped step ${s.id} "${s.description}" (optional)`);
      return false;
    }
    return true;
  });
  return { plan: { ...plan, steps: survivors }, rationale, removed };
}

/**
 * Rule 5 — cap output: the terse-output rule. The contracted plan's output
 * estimate is recomputed from the surviving file/step counts (lighter per
 * unit than the original), which is what produces the token delta.
 */
export function capOutput(plan: Plan): {
  plan: Plan;
  rationale: string[];
  output_length_tokens: number;
} {
  const tokens = estimateContractedTokens(plan);
  return {
    plan,
    rationale: [`capped output to ${tokens} tokens (terse-output rule)`],
    output_length_tokens: tokens,
  };
}

// --- Full pipeline ----------------------------------------------------------

/** Apply every contraction rule in order and return a structured outcome. */
export function applyContractionRules(plan: Plan): ContractionOutcome {
  const mergedFiles: string[] = [];
  const removedFiles: string[] = [];
  const mergedSteps: string[] = [];
  const removedSteps: string[] = [];
  const rationale: string[] = [];

  let current = plan;

  const d1 = dedupFiles(current);
  current = d1.plan;
  mergedFiles.push(...d1.merged);
  rationale.push(...d1.rationale);

  const d2 = mergeHelpers(current);
  current = d2.plan;
  mergedFiles.push(...d2.merged);
  rationale.push(...d2.rationale);

  const d3 = dropOptionalFiles(current);
  current = d3.plan;
  removedFiles.push(...d3.removed);
  rationale.push(...d3.rationale);

  const d4 = dropOptionalSteps(current);
  current = d4.plan;
  removedSteps.push(...d4.removed);
  rationale.push(...d4.rationale);

  const d5 = capOutput(current);
  rationale.push(...d5.rationale);

  return {
    contractedPlan: d5.plan,
    removedFiles,
    mergedFiles,
    removedSteps,
    mergedSteps,
    rationale,
  };
}

// --- Build the ContractionDiff ---------------------------------------------

/**
 * Compose a ContractionDiff from the original manifest and a contraction
 * outcome. The diff is structural and countable: files before/after, steps
 * before/after, tokens before/after, plus a per-line rationale for every
 * change.
 */
export function buildContractionDiff(
  originalManifest: ScopeManifest,
  outcome: ContractionOutcome,
): ContractionDiff {
  const contractedFiles = [...new Set(outcome.contractedPlan.files.map((f) => f.path))];
  const contractedManifest: ScopeManifest = {
    intent: outcome.contractedPlan.intent,
    files_touched: contractedFiles,
    steps: outcome.contractedPlan.steps.map((s) => ({ ...s })),
    output_length_tokens: estimateContractedTokens(outcome.contractedPlan),
    blast_radius: classifyBlastRadius(contractedFiles.length),
  };

  const output_delta = originalManifest.output_length_tokens - contractedManifest.output_length_tokens;

  return {
    original: originalManifest,
    contracted: contractedManifest,
    file_diff: {
      removed: outcome.removedFiles,
      merged: outcome.mergedFiles,
    },
    step_diff: {
      removed: outcome.removedSteps,
      merged: outcome.mergedSteps,
    },
    output_delta,
    rationale: outcome.rationale,
  };
}
