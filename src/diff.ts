import { diffLines, type Change } from "diff";
import type { ContractionDiff, ScopeManifest } from "./manifest.js";

/**
 * The diff module turns a ContractionDiff into a textual structural-diff using
 * the `diff` package's line differ. The ContractionDiff is already a structured
 * before/after object; this module adds the countable line-by-line view
 * (removed vs added file/step lines) that the terminal renderer colorizes and a
 * human screenshots to post.
 */

/** Render a manifest as the canonical multi-line scope text used for diffing. */
export function manifestToScopeText(m: ScopeManifest): string {
  const lines: string[] = [];
  lines.push(`intent: ${m.intent}`);
  lines.push(`blast_radius: ${m.blast_radius}`);
  lines.push("files:");
  for (const f of m.files_touched) lines.push(`  ${f}`);
  lines.push("steps:");
  for (const s of m.steps) {
    const tag = s.optional ? " (optional)" : "";
    lines.push(`  [${s.id}] ${s.description}${tag}`);
  }
  lines.push(`output_length_tokens: ${m.output_length_tokens}`);
  return lines.join("\n") + "\n";
}

/**
 * Produce a line-level diff between the original and contracted scope text.
 * Each `Change` carries `value`, `added`, and `removed` flags — the renderer
 * colorizes them. This is the machine-checkable structural-diff view.
 */
export function structuralLineDiff(diff: ContractionDiff): Change[] {
  const before = manifestToScopeText(diff.original);
  const after = manifestToScopeText(diff.contracted);
  return diffLines(before, after);
}

/**
 * Produce a minimal unified-style patch string (for the `scopereflex share`
 * path and CI logs). Headers are neutral so the patch is shareable without
 * leaking absolute paths.
 */
export function toUnifiedPatch(diff: ContractionDiff): string {
  const changes = structuralLineDiff(diff);
  return changes
    .map((c) => {
      const prefix = c.added ? "+" : c.removed ? "-" : " ";
      return c.value
        .split("\n")
        .filter((line, idx, arr) => idx < arr.length - 1 || line !== "")
        .map((line) => `${prefix}${line}`)
        .join("\n");
    })
    .join("\n");
}

/** Count the removed vs added lines in a structural diff (for headline stats). */
export function countChanges(changes: Change[]): { removed: number; added: number } {
  let removed = 0;
  let added = 0;
  for (const c of changes) {
    const lines = c.value.replace(/\n$/, "").split("\n").length;
    if (c.removed) removed += lines;
    else if (c.added) added += lines;
  }
  return { removed, added };
}
