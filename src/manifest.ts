import { z } from "zod";

/**
 * ScopeReflex core primitive — the ScopeManifest and ContractionDiff.
 *
 * The manifest is the lean, machine-checkable "scope" view of a coding agent's
 * plan: which files it touches, which steps it runs, how verbose the output is,
 * and the resulting blast radius. The ContractionDiff is a structural,
 * countable before/after diff between the agent's proposed plan and a
 * counterfactual contracted variant.
 *
 * This module is the single source of truth for the data shapes; every other
 * module (contract / rules / diff / gate) is pure plumbing over these types.
 */

// --- Blast radius -----------------------------------------------------------

export const BlastRadiusSchema = z.enum(["trivial", "moderate", "severe"]);
export type BlastRadius = z.infer<typeof BlastRadiusSchema>;

/**
 * Classify blast radius from the number of files a plan touches.
 *
 *   trivial  — 1-3 files  (a focused, low-risk change)
 *   moderate — 4-7 files  (a normal multi-file feature)
 *   severe   — 8+ files    (wide blast radius, review-heavy)
 */
export function classifyBlastRadius(fileCount: number): BlastRadius {
  if (fileCount <= 3) return "trivial";
  if (fileCount <= 7) return "moderate";
  return "severe";
}

// --- Steps ------------------------------------------------------------------

export const StepSchema = z.object({
  id: z.string().min(1),
  description: z.string(),
  optional: z.boolean().default(false),
});
export type Step = z.infer<typeof StepSchema>;

// --- ScopeManifest ----------------------------------------------------------

export const ScopeManifestSchema = z.object({
  intent: z.string().default(""),
  files_touched: z.array(z.string()),
  steps: z.array(StepSchema),
  output_length_tokens: z.number().int().nonnegative(),
  blast_radius: BlastRadiusSchema,
});
export type ScopeManifest = z.infer<typeof ScopeManifestSchema>;

// --- ContractionDiff --------------------------------------------------------

export const FileDiffSchema = z.object({
  removed: z.array(z.string()),
  merged: z.array(z.string()),
});
export const StepDiffSchema = z.object({
  removed: z.array(z.string()),
  merged: z.array(z.string()),
});

export const ContractionDiffSchema = z.object({
  original: ScopeManifestSchema,
  contracted: ScopeManifestSchema,
  file_diff: FileDiffSchema,
  step_diff: StepDiffSchema,
  output_delta: z.number().int(),
  rationale: z.array(z.string()),
});
export type ContractionDiff = z.infer<typeof ContractionDiffSchema>;

// --- Helpers ----------------------------------------------------------------

/**
 * Recompute the derived fields of a manifest (blast radius) after its file
 * list has changed. Used by the gate's "edit" path so a hand-trimmed manifest
 * stays internally consistent.
 */
export function recomputeManifest(manifest: ScopeManifest): ScopeManifest {
  return {
    ...manifest,
    files_touched: [...new Set(manifest.files_touched)],
    blast_radius: classifyBlastRadius(new Set(manifest.files_touched).size),
  };
}
