[简体中文](./README.zh-CN.md) · [Website](https://scopereflex.lei6393.com) · [GitHub](https://github.com/SuperMarioYL/scopereflex)

<picture>
  <source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="./assets/presentation/hero-mobile-dark.svg">
  <source media="(max-width: 600px)" srcset="./assets/presentation/hero-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="./assets/presentation/hero-dark.svg">
  <img src="./assets/presentation/hero-light.svg" width="960" alt="Hero diagram">
</picture>

# scopereflex

**Review a smaller plan before accepting the work.**

ScopeReflex derives a contracted variant of a JSON or Markdown plan and presents the structural difference for review.

## Why use it

Optional steps and duplicate file entries can make a proposed plan harder to assess. A rule-generated alternative lets you inspect what would be dropped or merged before accepting it.

- **Compare alternatives** — The original and contracted manifests are both retained.
- **Inspect every removal** — Rules record the rationale for contraction.
- **Choose before writing** — The gate separates review from accepted-plan output.

## Architecture

<picture>
  <source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="./assets/presentation/architecture-mobile-dark.svg">
  <source media="(max-width: 600px)" srcset="./assets/presentation/architecture-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="./assets/presentation/architecture-dark.svg">
  <img src="./assets/presentation/architecture-light.svg" width="960" alt="Architecture diagram">
</picture>

The parser validates the plan. Ordered rules deduplicate files, merge helper descriptions into sibling indexes, drop optional files and steps, and estimate a shorter output. contract reports the diff; gate can write a contracted plan after a selection.

| Component | Responsibility |
| --- | --- |
| `JSON / Markdown plan` | src/contract.ts |
| `Contraction rules` | src/rules.ts |
| `Structural diff` | src/manifest.ts |
| `Review gate` | src/gate.ts |

## Install and quickstart

Build with the version declared in the repository manifest. Run the example from the repository root.

```bash
git clone https://github.com/SuperMarioYL/scopereflex.git
cd scopereflex
npm ci
npm run build
```

Apply contract --summary to the complete bundled plan without writing an accepted plan.

```bash
node dist/src/index.js contract examples/plan.json --summary
```

## Recorded demo

<picture>
  <source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="./assets/presentation/process-mobile-dark.svg">
  <source media="(max-width: 600px)" srcset="./assets/presentation/process-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="./assets/presentation/process-dark.svg">
  <img src="./assets/presentation/process-light.svg" width="960" alt="Process diagram">
</picture>

The bundled plan contracts from 14 to 4 files; displayed token savings are estimated by the rule model.

```text
ScopeReflex: 14→4 files, 3200→850 tokens (saved 2350 tokens)
```

The complete command and output are recorded in [docs/demo-results.json](./docs/demo-results.json). Inputs and reproduction code are included in the repository.

![Existing terminal recording](./assets/demo.gif)

The existing recording is retained for context; the text example above documents the reproducible scenario.

## Usage

The CLI exposes the following operations. Commands after the example use your own paths or identifiers.

```bash
node dist/src/index.js contract examples/plan.json
node dist/src/index.js contract examples/plan.json --json
node dist/src/index.js gate examples/plan.json
```

## Configuration

Mark optional files and steps explicitly in the input. output_length_tokens can supply the original estimate; otherwise the tool estimates it. contract is read-only. gate writes a separate contracted plan on acceptance; --accept bypasses the interactive review.

## Integrations and responsibilities

<picture>
  <source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="./assets/presentation/integrations-mobile-dark.svg">
  <source media="(max-width: 600px)" srcset="./assets/presentation/integrations-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="./assets/presentation/integrations-dark.svg">
  <img src="./assets/presentation/integrations-light.svg" width="960" alt="Integrations diagram">
</picture>

The following routes are implemented in the source. Choose the input that matches your task and keep the resulting artifact with your project.

| Route | Implemented role |
| --- | --- |
| Plan JSON | Files, optional flags and steps |
| Markdown dialect | Lightweight plan input |
| JSON / summary | Contraction difference |
| Accepted plan | Separate output artifact |

## Limits and next steps

- Rules do not inspect the implementation or prove that the smaller plan satisfies the task. Review removed work before accepting it.
- Token values are heuristics based on file/step counts and different coefficients, not measured output savings.
- The demo only reports a contraction. It does not accept a plan or modify source code.

Semantic task validation and smarter contraction require additional evidence beyond the current structural rules.

## License and contributions

See [LICENSE](./LICENSE). When reporting an issue, include a minimal input, the command, and the observed output.
