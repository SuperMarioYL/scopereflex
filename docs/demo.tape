# docs/demo.tape — ScopeReflex happy path, rendered to assets/demo.gif.
# Render locally:  vhs docs/demo.tape        (run from the repo root, after `npm run build`)
# Render in CI:    .github/workflows/demo.yml (manual dispatch — installs + builds first)
#
# The tape drives the real built binary (dist/src/index.js). It uses only
# relative paths so no absolute path leaks into the rendered gif.

Output assets/demo.gif
Set FontSize 14
Set Width 1280
Set Height 720
Set Padding 20
Set Theme "Dracula"

Type "scopereflex contract examples/plan.json --summary"
Sleep 500ms
Enter
Sleep 2s

Type "scopereflex contract examples/plan.json"
Sleep 500ms
Enter
Sleep 4s

Type "scopereflex gate examples/plan.json --accept"
Sleep 500ms
Enter
Sleep 4s

Type "head -n 14 examples/plan.contracted.json"
Sleep 500ms
Enter
Sleep 3s

Type "echo 'agent wanted 14 files, accepted 4 — saved 2,350 tokens'"
Sleep 500ms
Enter
Sleep 3s
