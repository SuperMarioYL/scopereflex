import chalk from "chalk";
import type { ContractionDiff } from "./manifest.js";
import { structuralLineDiff, countChanges } from "./diff.js";

/**
 * The format module renders a ContractionDiff as the terminal "contraction-diff"
 * view: a countable headline (files before/after, steps before/after, tokens
 * before/after) followed by a per-change rationale list and a colored line
 * diff. This is the star-growth artifact a developer screenshots and posts.
 */

const BOX_WIDTH = 45;

function rule(width: number, ch = "─"): string {
  return ch.repeat(width);
}

function fmtDelta(n: number, suffix = ""): string {
  if (n === 0) return chalk.dim(`±0${suffix}`);
  if (n > 0) return chalk.green(`-${n}${suffix}`);
  return chalk.yellow(`+${Math.abs(n)}${suffix}`);
}

/** Render the boxed headline stats: files/steps/tokens before -> after. */
export function renderHeadline(diff: ContractionDiff): string {
  const o = diff.original;
  const c = diff.contracted;
  // Deltas are reductions: original - contracted. Positive = fewer (good),
  // rendered as a green "-N"; negative = the plan grew (warning, yellow "+N").
  const fileDelta = o.files_touched.length - c.files_touched.length;
  const stepDelta = o.steps.length - c.steps.length;
  const tokenDelta = diff.output_delta;

  const lines: string[] = [];
  lines.push(chalk.cyan.bold("ScopeReflex Contraction-Diff"));
  lines.push(chalk.dim(rule(BOX_WIDTH)));
  lines.push(
    `${chalk.bold("Files:")}   ${o.files_touched.length} → ${c.files_touched.length}    ${fmtDelta(fileDelta)}`,
  );
  lines.push(
    `${chalk.bold("Steps:")}   ${o.steps.length} → ${c.steps.length}    ${fmtDelta(stepDelta)}`,
  );
  lines.push(
    `${chalk.bold("Output:")}  ${o.output_length_tokens.toLocaleString()} → ${c.output_length_tokens.toLocaleString()} tokens  ${fmtDelta(tokenDelta)}`,
  );
  lines.push(
    `${chalk.bold("Blast:")}   ${blastLabel(o.blast_radius)} → ${blastLabel(c.blast_radius)}`,
  );
  return lines.join("\n");
}

function blastLabel(b: ContractionDiff["original"]["blast_radius"]): string {
  switch (b) {
    case "trivial":
      return chalk.green(b);
    case "moderate":
      return chalk.yellow(b);
    case "severe":
      return chalk.red(b);
  }
}

/** Render the rationale list (every removed/merged artifact + the terse-output cap). */
export function renderRationale(diff: ContractionDiff): string {
  const lines: string[] = [];
  const entries: string[] = [];
  for (const f of diff.file_diff.removed) {
    entries.push(`${chalk.red("-")} ${chalk.strikethrough.dim(f)} (optional, not on critical path)`);
  }
  for (const f of diff.file_diff.merged) {
    entries.push(`${chalk.magenta("↪")} ${chalk.strikethrough.dim(f)} (merged into sibling index)`);
  }
  for (const s of diff.step_diff.removed) {
    entries.push(`${chalk.red("-")} step ${chalk.strikethrough.dim(s)} (optional)`);
  }
  for (const r of diff.rationale) {
    // Skip the raw rationale lines we already rendered as file/step entries,
    // but keep the terse-output cap line and any dedup summary.
    if (
      r.startsWith("dropped ") ||
      r.startsWith("merged ") ||
      r.startsWith("deduplicated ")
    ) {
      continue;
    }
    entries.push(`${chalk.blue("•")} ${r}`);
  }
  if (entries.length === 0) {
    lines.push(chalk.dim("No contractions applied — plan is already minimal."));
  } else {
    lines.push(...entries);
  }
  return lines.join("\n");
}

/** Render the colored line-by-line structural diff. */
export function renderStructuralDiff(diff: ContractionDiff): string {
  const changes = structuralLineDiff(diff);
  const { removed, added } = countChanges(changes);
  const out: string[] = [];
  out.push(chalk.dim(rule(BOX_WIDTH)));
  out.push(chalk.dim(`structural diff (${removed} removed, ${added} added)`));
  for (const c of changes) {
    const value = c.value.replace(/\n$/, "");
    if (value === "") continue;
    for (const line of value.split("\n")) {
      if (c.added) out.push(chalk.green(`+ ${line}`));
      else if (c.removed) out.push(chalk.red(`- ${line}`));
      else out.push(chalk.dim(`  ${line}`));
    }
  }
  return out.join("\n");
}

/** Full rendered contraction-diff block (headline + rationale + structural diff). */
export function renderContractionDiff(diff: ContractionDiff): string {
  return [renderHeadline(diff), "", renderRationale(diff), "", renderStructuralDiff(diff)].join(
    "\n",
  );
}

/** One-line summary for logs / CI / the `share` path. */
export function renderSummary(diff: ContractionDiff): string {
  const o = diff.original;
  const c = diff.contracted;
  const files = `${o.files_touched.length}→${c.files_touched.length} files`;
  const tokens = `${o.output_length_tokens}→${c.output_length_tokens} tokens`;
  const saved = diff.output_delta > 0 ? ` (saved ${diff.output_delta} tokens)` : "";
  return `ScopeReflex: ${files}, ${tokens}${saved}`;
}
