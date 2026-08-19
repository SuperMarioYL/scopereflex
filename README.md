<div align="right"><sub><b>English</b>&nbsp;&nbsp;⇄&nbsp;&nbsp;<a href="./README.zh-CN.md">中文</a></sub></div>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/hero-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./assets/hero-light.svg">
  <img src="./assets/hero-light.svg" width="880" alt="ScopeReflex — the contraction-reflex for over-producing coding agents">
</picture>

<p align="center"><sub>Counterfactual contraction-reflex for over-producing coding agents. Fork a do-less plan, accept the diff.</sub></p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="license"></a>
  <img src="https://img.shields.io/github/v/release/SuperMarioYL/scopereflex" alt="latest release">
  <img src="https://img.shields.io/github/actions/workflow/status/SuperMarioYL/scopereflex/ci.yml?branch=main&label=ci&logo=github" alt="CI">
  <img src="https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white" alt="node">
  <img src="https://img.shields.io/badge/Coding%20Agent-scope--reflex-5E5CE6" alt="Coding Agent">
  <img src="https://img.shields.io/badge/Agent-contraction--diff-10A37F" alt="Agent">
</p>

**When your coding agent proposes a 14-file plan for a 4-file job, ScopeReflex forks the do-less counterfactual and shows you a countable diff to accept before the agent proceeds.**

Frontier coding agents now finish tasks reliably — and the binding constraint flipped from "can it complete?" to "it does too much." The r/ClaudeAI Opus-5 grievance ("I legit don't read 90% of the output anymore") is the model-attributed pain. ScopeReflex is the **Coding Agent** reflex that [headroomlabs-ai/headroom](https://github.com/headroomlabs-ai/headroom)-style agents miss at plan-approval: it forks a do-less counterfactual and a machine-checkable structural diff — the heavier **Agent** primitive [@DietrichGebert](https://github.com/DietrichGebert)'s 105k-star [ponytail](https://github.com/DietrichGebert/ponytail) proved the demand for but never built. Ponytail stops at a prompt-nudge; ScopeReflex adds the fork + diff + acceptance gate.

## Table of Contents

- [Architecture](#architecture)
- [Why this exists](#why-this-exists)
- [Install & Quickstart](#install--quickstart)
- [Usage](#usage)
- [Demo](#demo)
- [vs ponytail](#vs-ponytail)
- [Roadmap](#roadmap)
- [License](#license)

<h2><img src="https://api.iconify.design/tabler/topology-star-3.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> Architecture</h2>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/atlas-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./assets/atlas-light.svg">
  <img src="./assets/atlas-light.svg" width="880" alt="Architecture: Agent Plan → Contraction Engine → Diff Renderer → Acceptance Gate → Contracted Plan">
</picture>

Single process, single CLI. No daemon, no config file, no API key. Your agent's plan goes in as JSON or markdown; the contraction engine applies deterministic rules and emits a structural `ContractionDiff`; the gate renders it, you accept/edit/reject, and the contracted plan is written for the agent to execute.

<h2><img src="https://api.iconify.design/tabler/bulb.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> Why this exists</h2>

Operators routinely approve a 12-file plan when a 3-file variant would satisfy the task — and no machine-generated smaller alternative is placed beside it for comparison. ScopeReflex turns "is this the right scope?" from a human-only judgment into a surfaced, diffable choice. The new primitive is the **ContractionDiff**: a machine-checkable structural scope-diff (files before→after, steps before→after, tokens before→after) between an agent's proposed plan and a counterfactual contracted variant — not a post-hoc rationalization.

<h2><img src="https://api.iconify.design/tabler/rocket.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> Install & Quickstart</h2>

Three commands from a cold clone to your first contraction-diff:

```bash
git clone https://github.com/SuperMarioYL/scopereflex && cd scopereflex
npm install && npm run build
node dist/src/index.js contract examples/plan.json
```

<details>
<summary>sample output</summary>

```
ScopeReflex Contraction-Diff
─────────────────────────────────────────────
Files:   14 → 4    -10
Steps:   12 → 5    -7
Output:  3,200 → 850 tokens  -2350
Blast:   severe → moderate

- src/api/v2/legacy.ts (optional, not on critical path)
- docs/login.md (optional, not on critical path)
↪ src/utils/helpers.ts (merged into sibling index)
• capped output to 850 tokens (terse-output rule)
```

</details>

Once published to npm, the zero-install path is `npx scopereflex contract plan.json`.

<h2><img src="https://api.iconify.design/tabler/terminal-2.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> Usage</h2>

Two subcommands — `contract` (emit the diff) and `gate` (accept/reject/edit). A plan is a JSON file (or markdown — see `examples/plan.md`):

```json
{
  "intent": "Add a login endpoint with session handling",
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

The five most common workflows:

```bash
# 1. See the contraction-diff for a plan
scopereflex contract examples/plan.json

# 2. One-line summary for logs / CI
scopereflex contract examples/plan.json --summary

# 3. Machine-readable diff (pipe into a harness)
scopereflex contract examples/plan.json --json

# 4. Interactive gate — accept / edit / reject, writes plan.contracted.json
scopereflex gate examples/plan.json

# 5. Non-interactive accept (CI / demos)
scopereflex gate examples/plan.json --accept
```

The contraction rules are deterministic, so every diff is auditable:

1. **Dedup** — collapse duplicate file paths.
2. **Merge helpers** — fold `helpers.ts`/`utils.ts`/`common.ts` into a sibling `index.ts`.
3. **Drop optional files** — any file flagged `optional: true`.
4. **Drop optional steps** — any step flagged `optional: true`.
5. **Cap output** — the terse-output rule recomputes the token estimate from the survivors.

<h2><img src="https://api.iconify.design/tabler/photo.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> Demo</h2>

![demo](assets/demo.gif)

A full plan → diff → accepted contracted plan run. The asciinema source cast is at [`assets/demo.cast`](./assets/demo.cast) (re-recordable via the [`docs/demo.tape`](./docs/demo.tape) vhs script). Re-render the gif on demand with the `demo` workflow.

<h2><img src="https://api.iconify.design/tabler/chart-arrows.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> vs ponytail</h2>

The nearest demand-neighbor is [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) (105k stars) — the prompt-nudge version of the same do-less thesis. ScopeReflex is the heavier primitive.

| Axis | ScopeReflex | ponytail |
|---|---|---|
| Do-less thesis | ✓ forked counterfactual | ✓ prompt-nudge |
| Structural contraction-diff | ✓ machine-checkable | — none |
| Human acceptance gate | ✓ accept / edit / reject | — none |
| Install friction | partial — needs a checkpoint hook | ✓ copy a prompt, zero integration |
| Adoption | — new | ✓ 105k stars |

Ponytail wins on install friction and adoption — that is the honest comparison. ScopeReflex wins on the fork + diff + gate triad a prompt-skill structurally cannot host.

<h2><img src="https://api.iconify.design/tabler/map-2.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> Roadmap</h2>

- [x] **m1 — contract engine**: parse a plan into a `ScopeManifest`, apply contraction rules, emit a `ContractionDiff` to stdout.
- [x] **m2 — acceptance gate**: interactive TUI renders the diff, prompts accept/reject/edit, writes `plan.contracted.json` on accept.
- [ ] **m3 — skill & demo**: Claude Code `SKILL.md` wrapper (shipped), bilingual README (shipped), real asciinema recording (pending a human run).
- [ ] **future**: harness-agnostic install for Cursor / Codex CLI / Aider, an eval suite on blast-radius reduction, and a `scopereflex share` command emitting a copy-pasteable diff.

<h2><img src="https://api.iconify.design/tabler/license.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> License</h2>

MIT — see [LICENSE](./LICENSE). File issues and PRs on the [issue tracker](https://github.com/SuperMarioYL/scopereflex/issues).

## Share this

```
ScopeReflex — the Coding Agent reflex: fork a do-less plan variant, surface a machine-checkable contraction-diff, gate it behind a human accept. Ship the 4-file variant your agent should've proposed, not the 14-file one it did. https://github.com/SuperMarioYL/scopereflex
```

After pushing, set repo topics so the right audience finds it:

```bash
gh repo edit --add-topic coding-agent --add-topic agent --add-topic cli --add-topic developer-tools
```

<p align="center"><sub><a href="./LICENSE">MIT</a> © 2026 SuperMarioYL</sub></p>
