import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  BlastRadiusSchema,
  ContractionDiffSchema,
  ScopeManifestSchema,
  StepSchema,
  classifyBlastRadius,
  recomputeManifest,
} from "../src/manifest.js";
import {
  PlanSchema,
  type Plan,
  parsePlan,
  planToManifest,
  estimateContractedTokens,
  PlanParseError,
  serializeContractedPlan,
} from "../src/contract.js";
import {
  applyContractionRules,
  buildContractionDiff,
  dedupFiles,
  mergeHelpers,
  dropOptionalFiles,
  dropOptionalSteps,
} from "../src/rules.js";
import { structuralLineDiff, countChanges, manifestToScopeText } from "../src/diff.js";
import {
  applyGateDecision,
  writeContractedPlan,
  defaultContractedPath,
} from "../src/gate.js";
import { renderHeadline, renderSummary } from "../src/format.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const examplePlanPath = join(repoRoot, "examples", "plan.json");

const examplePlanRaw = readFileSync(examplePlanPath, "utf8");

// A 14-file / 12-step plan: 4 non-optional files (login, session, client,
// utils/index), 1 helper merged away, 9 optional files dropped, 7 optional
// steps dropped. The canonical contraction-diff example (14 -> 4 files,
// 12 -> 5 steps, 3200 -> 850 tokens).
function examplePlan(): Plan {
  return parsePlan(examplePlanRaw);
}

describe("manifest / zod validation", () => {
  it("validates a well-formed ScopeManifest", () => {
    const m = ScopeManifestSchema.parse({
      intent: "x",
      files_touched: ["a.ts", "b.ts"],
      steps: [{ id: "1", description: "do thing", optional: false }],
      output_length_tokens: 100,
      blast_radius: "trivial",
    });
    assert.equal(m.files_touched.length, 2);
    assert.equal(m.blast_radius, "trivial");
  });

  it("rejects an invalid blast radius", () => {
    const r = BlastRadiusSchema.safeParse("huge");
    assert.equal(r.success, false);
  });

  it("defaults step.optional to false and accepts enum blast radius", () => {
    const s = StepSchema.parse({ id: "2", description: "x" });
    assert.equal(s.optional, false);
    assert.equal(BlastRadiusSchema.parse("severe"), "severe");
  });

  it("classifies blast radius at the right thresholds", () => {
    assert.equal(classifyBlastRadius(1), "trivial");
    assert.equal(classifyBlastRadius(3), "trivial");
    assert.equal(classifyBlastRadius(4), "moderate");
    assert.equal(classifyBlastRadius(7), "moderate");
    assert.equal(classifyBlastRadius(8), "severe");
    assert.equal(classifyBlastRadius(20), "severe");
  });

  it("recomputeManifest dedups files and recomputes blast radius", () => {
    const m = recomputeManifest({
      intent: "x",
      files_touched: ["a.ts", "a.ts", "b.ts", "c.ts", "d.ts"],
      steps: [],
      output_length_tokens: 0,
      blast_radius: "severe",
    });
    assert.deepEqual(m.files_touched, ["a.ts", "b.ts", "c.ts", "d.ts"]);
    assert.equal(m.blast_radius, "moderate");
  });
});

describe("contract — plan parsing", () => {
  it("parses the JSON example into 14 files / 12 steps / 3200 tokens", () => {
    const plan = examplePlan();
    assert.equal(plan.intent, "Add a login endpoint with session handling");
    assert.equal(plan.files.length, 14);
    assert.equal(plan.steps.length, 12);
    assert.equal(plan.output_length_tokens, 3200);
  });

  it("PlanSchema applies defaults for missing optional fields", () => {
    const p = PlanSchema.parse({ intent: "y", files: [{ path: "a.ts" }], steps: [] });
    assert.equal(p.files[0].optional, false);
    assert.equal(p.files[0].purpose, "");
    assert.equal(p.intent, "y");
  });

  it("parses a markdown plan with intent/files/steps/output", () => {
    const md = [
      "# Plan: Ship a thing",
      "",
      "## Files",
      "- src/a.ts — the thing",
      "- src/helpers.ts (optional) — helpers",
      "",
      "## Steps",
      "1. Build it",
      "2. Polish it (optional)",
      "",
      "## Output",
      "~1200 tokens",
    ].join("\n");
    const plan = parsePlan(md);
    assert.equal(plan.intent, "Ship a thing");
    assert.equal(plan.files.length, 2);
    assert.equal(plan.files[0].path, "src/a.ts");
    assert.equal(plan.files[1].optional, true);
    assert.equal(plan.steps.length, 2);
    assert.equal(plan.steps[0].id, "1");
    assert.equal(plan.steps[1].optional, true);
    assert.equal(plan.output_length_tokens, 1200);
  });

  it("throws PlanParseError on invalid JSON", () => {
    assert.throws(() => parsePlan("{ not json }"), PlanParseError);
  });

  it("throws PlanParseError on a JSON plan failing schema", () => {
    assert.throws(
      () => parsePlan('{"files":[{"path":""}]}'),
      PlanParseError,
    );
  });

  it("planToManifest dedups files, classifies blast radius, uses provided tokens", () => {
    const plan = examplePlan();
    const m = planToManifest(plan);
    assert.equal(m.files_touched.length, 14);
    assert.equal(m.blast_radius, "severe");
    assert.equal(m.output_length_tokens, 3200);
  });

  it("estimates contracted tokens to the canonical 850 for 4 files / 5 steps", () => {
    const plan: Plan = {
      intent: "x",
      files: [
        { path: "a.ts", purpose: "", optional: false },
        { path: "b.ts", purpose: "", optional: false },
        { path: "c.ts", purpose: "", optional: false },
        { path: "d.ts", purpose: "", optional: false },
      ],
      steps: [
        { id: "1", description: "a", optional: false },
        { id: "2", description: "b", optional: false },
        { id: "3", description: "c", optional: false },
        { id: "4", description: "d", optional: false },
        { id: "5", description: "e", optional: false },
      ],
      output_length_tokens: 3200,
    };
    assert.equal(estimateContractedTokens(plan), 850);
  });
});

describe("rules — contraction pipeline", () => {
  it("dedupFiles collapses duplicate paths", () => {
    const plan: Plan = {
      intent: "",
      files: [
        { path: "a.ts", purpose: "", optional: false },
        { path: "a.ts", purpose: "", optional: false },
        { path: "b.ts", purpose: "", optional: false },
      ],
      steps: [],
      output_length_tokens: 100,
    };
    const r = dedupFiles(plan);
    assert.equal(r.plan.files.length, 2);
    assert.deepEqual(r.merged, ["a.ts"]);
  });

  it("mergeHelpers folds helper files into a sibling index", () => {
    const plan: Plan = {
      intent: "",
      files: [
        { path: "src/utils/index.ts", purpose: "barrel", optional: false },
        { path: "src/utils/helpers.ts", purpose: "misc", optional: false },
        { path: "src/other/helpers.ts", purpose: "no sibling", optional: false },
      ],
      steps: [],
      output_length_tokens: 100,
    };
    const r = mergeHelpers(plan);
    assert.equal(r.plan.files.length, 2);
    assert.deepEqual(r.merged, ["src/utils/helpers.ts"]);
    assert.ok(r.plan.files.some((f) => f.path === "src/utils/index.ts"));
    assert.ok(r.plan.files.some((f) => f.path === "src/other/helpers.ts"));
  });

  it("dropOptionalFiles removes optional files", () => {
    const plan: Plan = {
      intent: "",
      files: [
        { path: "a.ts", purpose: "", optional: false },
        { path: "b.ts", purpose: "", optional: true },
      ],
      steps: [],
      output_length_tokens: 100,
    };
    const r = dropOptionalFiles(plan);
    assert.equal(r.plan.files.length, 1);
    assert.deepEqual(r.removed, ["b.ts"]);
  });

  it("dropOptionalSteps removes optional steps", () => {
    const plan: Plan = {
      intent: "",
      files: [],
      steps: [
        { id: "1", description: "keep", optional: false },
        { id: "2", description: "drop", optional: true },
      ],
      output_length_tokens: 100,
    };
    const r = dropOptionalSteps(plan);
    assert.equal(r.plan.steps.length, 1);
    assert.deepEqual(r.removed, ["2"]);
  });

  it("contracts the 14-file example to exactly 4 surviving files + 5 steps", () => {
    const plan = examplePlan();
    const outcome = applyContractionRules(plan);
    assert.equal(outcome.contractedPlan.files.length, 4);
    const survivors = outcome.contractedPlan.files.map((f) => f.path).sort();
    assert.deepEqual(
      survivors,
      ["src/api/client.ts", "src/auth/login.ts", "src/auth/session.ts", "src/utils/index.ts"].sort(),
    );
    assert.equal(outcome.contractedPlan.steps.length, 5);
  });

  it("merges helpers and drops optional files/steps in the full pipeline", () => {
    const plan = examplePlan();
    const outcome = applyContractionRules(plan);
    assert.ok(outcome.mergedFiles.includes("src/utils/helpers.ts"));
    assert.ok(outcome.removedFiles.includes("src/api/v2/legacy.ts"));
    assert.ok(outcome.removedFiles.includes("docs/login.md"));
    assert.equal(outcome.removedSteps.length, 7);
    assert.equal(outcome.removedSteps.sort().join(","), "10,11,12,6,7,8,9");
    assert.ok(outcome.rationale.length > 0);
  });
});

describe("diff — structural contraction-diff", () => {
  it("builds a diff with the canonical output delta (3200 -> 850 = 2350)", () => {
    const plan = examplePlan();
    const originalManifest = planToManifest(plan);
    const outcome = applyContractionRules(plan);
    const diff = buildContractionDiff(originalManifest, outcome);
    assert.equal(diff.original.files_touched.length, 14);
    assert.equal(diff.contracted.files_touched.length, 4);
    assert.equal(diff.original.output_length_tokens, 3200);
    assert.equal(diff.contracted.output_length_tokens, 850);
    assert.equal(diff.output_delta, 2350);
    assert.equal(diff.contracted.blast_radius, "moderate");
    assert.ok(diff.file_diff.merged.includes("src/utils/helpers.ts"));
  });

  it("validates against the ContractionDiffSchema", () => {
    const plan = examplePlan();
    const diff = buildContractionDiff(planToManifest(plan), applyContractionRules(plan));
    assert.ok(ContractionDiffSchema.safeParse(diff).success);
  });

  it("structuralLineDiff produces removed + added changes", () => {
    const plan = examplePlan();
    const diff = buildContractionDiff(planToManifest(plan), applyContractionRules(plan));
    const changes = structuralLineDiff(diff);
    const { removed, added } = countChanges(changes);
    assert.ok(removed > 0, "expected removed lines");
    assert.ok(added > 0, "expected added lines");
  });

  it("manifestToScopeText includes intent, files, steps, output", () => {
    const plan = examplePlan();
    const text = manifestToScopeText(planToManifest(plan));
    assert.match(text, /intent:/);
    assert.match(text, /files:/);
    assert.match(text, /steps:/);
    assert.match(text, /output_length_tokens: 3200/);
  });
});

describe("gate — acceptance logic (m2)", () => {
  function exampleDiff() {
    const plan = examplePlan();
    return buildContractionDiff(planToManifest(plan), applyContractionRules(plan));
  }

  it("applyGateDecision accept returns the contracted manifest", () => {
    const diff = exampleDiff();
    const m = applyGateDecision(diff, { choice: "accept" });
    assert.ok(m);
    assert.equal(m.files_touched.length, 4);
    assert.equal(m.blast_radius, "moderate");
  });

  it("applyGateDecision reject returns null", () => {
    const diff = exampleDiff();
    const m = applyGateDecision(diff, { choice: "reject" });
    assert.equal(m, null);
  });

  it("applyGateDecision edit trims to the kept files and recomputes blast radius", () => {
    const diff = exampleDiff();
    const m = applyGateDecision(diff, {
      choice: "edit",
      keepFiles: ["src/auth/login.ts", "src/auth/session.ts"],
    });
    assert.ok(m);
    assert.equal(m.files_touched.length, 2);
    assert.equal(m.blast_radius, "trivial");
  });

  it("defaultContractedPath maps plan.json -> plan.contracted.json", () => {
    assert.equal(defaultContractedPath("plan.json"), "plan.contracted.json");
    assert.equal(defaultContractedPath("foo/bar/plan.md"), "foo/bar/plan.contracted.json");
    assert.equal(defaultContractedPath("plan.contracted.json"), "plan.contracted.json");
  });

  it("writeContractedPlan writes valid JSON to the contracted path", () => {
    const plan = examplePlan();
    const outcome = applyContractionRules(plan);
    const diff = buildContractionDiff(planToManifest(plan), outcome);
    const tmpPath = join(repoRoot, "node_modules", ".scopereflex-test-plan.json");
    const outPath = writeContractedPlan(outcome.contractedPlan, diff.contracted, tmpPath);
    assert.equal(outPath, tmpPath.replace(/\.json$/, ".contracted.json"));
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    assert.equal(written.intent, plan.intent);
    assert.equal(written.files.length, 4);
    assert.equal(written.contracted_by, "scopereflex");
    assert.equal(written.output_length_tokens, 850);
  });

  it("serializeContractedPlan emits the contracted_by marker", () => {
    const plan = examplePlan();
    const outcome = applyContractionRules(plan);
    const body = serializeContractedPlan(outcome.contractedPlan, 850);
    const parsed = JSON.parse(body);
    assert.equal(parsed.contracted_by, "scopereflex");
    assert.equal(parsed.output_length_tokens, 850);
  });
});

describe("format — rendering", () => {
  it("renderHeadline shows before/after file and token counts", () => {
    const plan = examplePlan();
    const diff = buildContractionDiff(planToManifest(plan), applyContractionRules(plan));
    const out = renderHeadline(diff);
    assert.match(out, /Files:/);
    assert.match(out, /14/);
    assert.match(out, /4/);
    assert.match(out, /3,200/);
    assert.match(out, /850/);
  });

  it("renderSummary is a single line with the headline reduction", () => {
    const plan = examplePlan();
    const diff = buildContractionDiff(planToManifest(plan), applyContractionRules(plan));
    const out = renderSummary(diff);
    assert.match(out, /14→4 files/);
    assert.match(out, /saved 2350 tokens/);
    assert.equal(out.includes("\n"), false);
  });
});
