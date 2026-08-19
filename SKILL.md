---
name: scopereflex
description: Counterfactual contraction-reflex for over-producing coding agents. At every plan-approval checkpoint, fork a do-less variant of your proposed plan and surface a structural contraction-diff for the human to accept before you proceed.
license: MIT
---

# ScopeReflex — contraction-reflex skill

A **Coding Agent** reflex that forks a counterfactual "do less" variant of your plan
and surfaces a structural, machine-checkable **ContractionDiff** (files before/after,
steps before/after, tokens before/after) with a human acceptance gate. Ship the 4-file
variant the agent should have proposed, not the 14-file one it actually did.

This skill is the bridge between ScopeReflex the CLI and the agent's plan-approval
checkpoint. The CLI is the source of truth for the contraction rules and the diff
format; this skill tells the agent **when** to invoke it.

## When to invoke

Invoke ScopeReflex at two checkpoints — never silently auto-apply a contraction:

1. **Plan-approval** — after you have assembled a proposed plan (a file list + ordered
   steps + an output estimate) and **before** you ask the human to approve it. Emit
   the contraction-diff beside your proposed plan so the human sees a smaller
   alternative at the same moment they decide scope.

2. **Output-finalization** — when you are about to finalize a verbose output. Run the
   contract step to see the terse-output delta, then let the gate trim it.

Do **not** invoke ScopeReflex for single-file edits where there is no contraction
surface (a one-file change has no smaller counterfactual). The reflex earns its place
only when the plan touches multiple files or emits verbose output.

## How to invoke

Assuming the CLI is installed (`npm install -g scopereflex` or `npx scopereflex`),
write your proposed plan to a JSON file and run the two subcommands. The plan schema
is intentionally minimal:

```json
{
  "intent": "<one-line description of the task>",
  "files": [
    { "path": "src/auth/login.ts", "purpose": "login route handler", "optional": false },
    { "path": "src/api/v2/legacy.ts", "purpose": "legacy v2 shim", "optional": true }
  ],
  "steps": [
    { "id": "1", "description": "Implement login endpoint", "optional": false },
    { "id": "2", "description": "Add legacy v2 shim", "optional": true }
  ],
  "output_length_tokens": 3200
}
```

Markdown plans are also accepted — see `examples/plan.md`.

### Step 1 — contract (m1)

```bash
scopereflex contract plan.json
```

Prints the **ContractionDiff** to stdout: a countable headline (`14 → 4 files`,
`3,200 → 850 tokens`), a per-change rationale list (every dropped/merged artifact),
and a colored structural line-diff. Pipe this to the human beside your proposed plan.

- `--json` emits the diff as machine-readable JSON (for piping into a harness).
- `--summary` emits a one-line summary for logs/CI.

### Step 2 — gate (m2)

```bash
scopereflex gate plan.json
```

Renders the diff, then prompts the human: **accept / edit / reject**.

- **accept** → writes `plan.contracted.json` (the do-less variant) for the agent to execute.
- **edit** → the human picks which files survive; the gate recomputes blast radius and writes the trimmed plan.
- **reject** → nothing is written; the agent proceeds with its original plan.

The gate is mandatory by design. ScopeReflex never auto-applies a contraction — a
do-less counterfactual the human never saw is worse than the original over-production.

For non-interactive runs (CI, demos), use `scopereflex gate plan.json --accept`.

## Agent workflow (Claude Code plan-approval hook)

1. Assemble your proposed plan as `plan.json` (files + steps + output estimate).
2. Run `scopereflex contract plan.json` and show the contraction-diff to the human
   **alongside** your proposed plan — "here is what I want to do, and here is the
   smaller variant ScopeReflex suggests."
3. Ask the human to run `scopereflex gate plan.json` (or run it yourself and relay
   the prompt). On accept, read `plan.contracted.json` and execute **that** plan
   instead of your original.
4. If the human rejects, execute your original plan unchanged.

## Contraction rules (deterministic)

The contraction engine applies rule-based heuristics — not an ML model — so every
diff is auditable:

1. **Dedup** — collapse duplicate file paths.
2. **Merge helpers** — fold `helpers.ts` / `utils.ts` / `common.ts` into a sibling
   `index.ts` in the same directory.
3. **Drop optional files** — any file flagged `optional: true` is removed (rationale:
   "optional, not on critical path").
4. **Drop optional steps** — any step flagged `optional: true` is removed.
5. **Cap output** — the terse-output rule recomputes the output estimate from the
   surviving file/step counts (lighter per unit), producing the token delta.

The diff is structural and countable, not a post-hoc rationalization — that is the
point: a machine-checkable scope-diff the human can screenshot, accept, and audit.

## Out of scope for v0.1

- Real-time agent output streaming (checkpoint-only).
- Web UI (CLI/TUI only).
- Multi-agent orchestration.
- Custom-trained ML contraction model (rule-based heuristics only).
- Auto-apply without human acceptance (the gate is mandatory).
