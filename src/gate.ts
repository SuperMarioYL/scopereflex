import { select, checkbox } from "@inquirer/prompts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, basename } from "node:path";
import {
  type ContractionDiff,
  type ScopeManifest,
  recomputeManifest,
} from "./manifest.js";
import { type Plan, parsePlan, serializeContractedPlan } from "./contract.js";
import { renderContractionDiff } from "./format.js";

/**
 * The acceptance gate — the human-in-the-loop checkpoint by design. It renders
 * the contraction-diff, prompts accept / reject / edit, and on accept writes a
 * `plan.contracted.json` the agent consumes. The gate is mandatory: ScopeReflex
 * never auto-applies a contraction (that is explicitly out of scope for v0.1).
 *
 * The pure decision + file-writing logic is split out (applyGateDecision /
 * writeContractedPlan) so it is unit-testable without driving an interactive
 * prompt.
 */

export type GateChoice = "accept" | "reject" | "edit";

export interface GateDecision {
  choice: GateChoice;
  /** Files to keep when editing (paths). Undefined for accept/reject. */
  keepFiles?: string[];
}

export interface GateResult {
  choice: GateChoice;
  writtenPath?: string;
  manifest?: ScopeManifest;
}

/**
 * Pure: resolve a gate decision against a contraction-diff into the manifest to
 * persist (or null for reject). Recomputes blast radius after any hand edits so
 * the written plan stays internally consistent.
 */
export function applyGateDecision(
  diff: ContractionDiff,
  decision: GateDecision,
): ScopeManifest | null {
  switch (decision.choice) {
    case "reject":
      return null;
    case "accept":
      return diff.contracted;
    case "edit": {
      const keep = new Set(decision.keepFiles ?? diff.contracted.files_touched);
      const trimmedFiles = diff.contracted.files_touched.filter((f) => keep.has(f));
      return recomputeManifest({
        ...diff.contracted,
        files_touched: trimmedFiles,
      });
    }
  }
}

/**
 * Pure: write the contracted plan to `<planPath>.contracted.json`. Returns the
 * written path. Throws if the plan path does not exist — the gate must operate
 * on a real file.
 */
export function writeContractedPlan(
  contractedPlan: Plan,
  manifest: ScopeManifest,
  planPath: string,
): string {
  const outPath = defaultContractedPath(planPath);
  writeFileSync(
    outPath,
    serializeContractedPlan(contractedPlan, manifest.output_length_tokens),
    "utf8",
  );
  return outPath;
}

/**
 * Default output path for a contracted plan. Strips a single extension and
 * appends `.contracted.json` (the contracted plan is always JSON):
 *
 *   plan.json             -> plan.contracted.json
 *   foo/bar/plan.md       -> foo/bar/plan.contracted.json
 *   plan.contracted.json  -> plan.contracted.json  (idempotent)
 */
export function defaultContractedPath(planPath: string): string {
  if (planPath.endsWith(".contracted.json")) return planPath;
  const ext = extname(planPath);
  const base = ext ? planPath.slice(0, -ext.length) : planPath;
  return `${base}.contracted.json`;
}

/**
 * Interactive gate entry point. Renders the diff, prompts the user, and writes
 * the contracted plan on accept (or after edits). Returns the result.
 */
export async function runGate(
  diff: ContractionDiff,
  contractedPlan: Plan,
  planPath: string,
): Promise<GateResult> {
  // Render the diff so the human can see what they're accepting.
  process.stdout.write(renderContractionDiff(diff) + "\n\n");

  const choice = (await select<GateChoice>({
    message: "Accept the contracted plan?",
    default: "accept",
    choices: [
      { name: "accept  — write plan.contracted.json", value: "accept" },
      { name: "edit    — pick which files survive", value: "edit" },
      { name: "reject  — keep the original plan", value: "reject" },
    ],
  })) as GateChoice;

  if (choice === "reject") {
    return { choice: "reject" };
  }

  let decision: GateDecision = { choice };
  if (choice === "edit") {
    const keep = (await checkbox<string>({
      message: "Select the files the agent should touch:",
      loop: false,
      required: true,
      choices: diff.contracted.files_touched.map((f) => ({
        name: f,
        value: f,
        checked: true,
      })),
    })) as string[];
    decision = { choice: "edit", keepFiles: keep };
  }

  const manifest = applyGateDecision(diff, decision);
  if (!manifest) {
    return { choice: "reject" };
  }
  const writtenPath = writeContractedPlan(contractedPlan, manifest, planPath);
  return { choice: decision.choice, writtenPath, manifest };
}

/** Read a plan file from disk and parse it. */
export function loadPlan(planPath: string): Plan {
  if (!existsSync(planPath)) {
    throw new Error(`plan not found: ${planPath}`);
  }
  const raw = readFileSync(planPath, "utf8");
  return parsePlan(raw);
}

/** True when the path looks like a plan file we accept (json/md/markdown). */
export function isPlanFile(path: string): boolean {
  const ext = extname(basename(path)).toLowerCase();
  return [".json", ".md", ".markdown", ".txt"].includes(ext);
}
