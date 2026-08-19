#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "node:fs";
import process from "node:process";
import { type Plan, parsePlan, planToManifest } from "./contract.js";
import { type ContractionDiff, ContractionDiffSchema } from "./manifest.js";
import { applyContractionRules, buildContractionDiff } from "./rules.js";
import { renderContractionDiff, renderSummary } from "./format.js";
import { runGate, loadPlan, writeContractedPlan } from "./gate.js";

/**
 * ScopeReflex CLI — a counterfactual contraction-reflex for over-producing
 * coding agents.
 *
 *   scopereflex contract plan.json   # emit the contraction-diff to stdout
 *   scopereflex gate plan.json       # interactive accept/reject/edit gate
 *
 * The `contract` subcommand is the m1 happy path; `gate` is the m2 acceptance
 * gate. Both fork a do-less counterfactual of the agent's plan, never mutate
 * the input, and surface a structural, machine-checkable diff.
 */

const program = new Command();

program
  .name("scopereflex")
  .description(
    "Counterfactual contraction-reflex for over-producing coding agents. Forks a do-less plan variant and surfaces a structural contraction-diff with a human acceptance gate.",
  )
  .version("0.1.0");

/** Read + parse a plan file into a Plan. Exits on parse error. */
function readPlan(path: string): Plan {
  try {
    return parsePlan(readFileSync(path, "utf8"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`error: could not parse plan "${path}": ${msg}`);
    process.exit(1);
  }
}

/** Build a ContractionDiff from a parsed plan (shared by contract + gate). */
function diffFromPlan(plan: Plan): ContractionDiff {
  const originalManifest = planToManifest(plan);
  const outcome = applyContractionRules(plan);
  return buildContractionDiff(originalManifest, outcome);
}

program
  .command("contract")
  .description("parse an agent plan, contract it, and emit the ContractionDiff to stdout")
  .argument("<plan>", "path to the agent's plan (.json or markdown)")
  .option("-j, --json", "emit the ContractionDiff as machine-readable JSON")
  .option("-s, --summary", "emit a one-line summary (for logs / CI)")
  .action((planPath: string, opts: { json?: boolean; summary?: boolean }) => {
    const plan = readPlan(planPath);
    const diff = diffFromPlan(plan);
    if (opts.summary) {
      process.stdout.write(renderSummary(diff) + "\n");
      return;
    }
    if (opts.json) {
      process.stdout.write(JSON.stringify(ContractionDiffSchema.parse(diff), null, 2) + "\n");
      return;
    }
    process.stdout.write(renderContractionDiff(diff) + "\n");
  });

program
  .command("gate")
  .description("interactive accept/reject/edit gate; writes plan.contracted.json on accept")
  .argument("<plan>", "path to the agent's plan (.json or markdown)")
  .option("--accept", "non-interactively accept the contraction and write the contracted plan")
  .action(async (planPath: string, opts: { accept?: boolean }) => {
    const plan = loadPlan(planPath);
    const originalManifest = planToManifest(plan);
    const outcome = applyContractionRules(plan);
    const diff = buildContractionDiff(originalManifest, outcome);

    if (opts.accept) {
      // Non-interactive path: write the contracted plan directly. Useful for CI
      // and the asciinema demo. The interactive path still renders the diff.
      process.stdout.write(renderContractionDiff(diff) + "\n\n");
      const outPath = writeContractedPlan(outcome.contractedPlan, diff.contracted, planPath);
      process.stdout.write(`accepted — wrote ${outPath}\n`);
      return;
    }

    try {
      const result = await runGate(diff, outcome.contractedPlan, planPath);
      if (result.choice === "reject") {
        process.stdout.write("rejected — keeping the original plan\n");
      } else if (result.writtenPath) {
        process.stdout.write(`accepted — wrote ${result.writtenPath}\n`);
      }
    } catch (err) {
      // Ctrl-C in an inquirer prompt rejects gracefully.
      if (err instanceof Error && err.name === "ExitPromptError") {
        process.stdout.write("rejected — keeping the original plan\n");
        process.exit(0);
      }
      throw err;
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
