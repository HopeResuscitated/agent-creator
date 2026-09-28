# agent creator evals

18 real tasks with automatic pass/fail checks, to measure how good the local agent is.
Every change you make to the agent (new model, new AGENTS.md rules, new tools, new loop)
should raise this score. If it doesn't, the change didn't help.

## Run it (in PowerShell, from the agent creator folder)

    cd "$HOME\Desktop\agent creator"

    node evals/run.ts                                      # all 18 tasks, local Ollama qwen3-coder (hermes-local-32k)
    node evals/run.ts --only T01,T02,T03                   # just a few
    node evals/run.ts --provider lmstudio --model omnicoder-9b    # compare another local model

Each run takes roughly 3-8 hours for all 18 tasks on the local model, so start it before bed.
It needs no attention and uses no cloud credits.

Results:
- `evals/results/<run>/summary.md`: the score table and why each task failed
- `evals/results/history.csv`: one line per run, so you can see progress over time
- `evals/results/<run>/<task>.transcript.txt`: what the agent actually said and did

## Checking the eval itself

    node evals/run.ts --agent none        # should score 0/18 (nothing done means nothing passes)
    node evals/run.ts --agent reference   # should score 18/18 (proves every task is passable)

Both were verified when the eval was built.

## Compare against another agent (Hermes, Copilot, you)

    node evals/run.ts --prepare T09       # makes a sandbox and prints the prompt
    (give that prompt to the other agent, working in the printed sandbox folder)
    node evals/run.ts --grade T09 "<sandbox folder>"

Tip for credits: only compare cloud agents on the tasks the local agent fails.

## The tasks

| # | Level | What it tests |
|---|---|---|
| T01 | easy | create a file |
| T02 | easy | one-line edit without touching anything else |
| T03 | easy | find code by what it does |
| T04 | easy | run tests and report the real number (no guessing) |
| T05 | easy | fix a failing test without editing the test |
| T06 | medium | implement slugify from a written spec |
| T07 | medium | parser with error handling |
| T08 | medium | add a tool following the existing patterns |
| T09 | medium | timing log (your spec 2) |
| T10 | medium | benchmark script (your spec 2) |
| T11 | medium | write tests that actually catch bugs |
| T12 | hard | npm run verify gate (your spec 3) |
| T13 | hard | orchestrator task lifecycle (your roadmap step 2) |
| T14 | hard | fix the dist/ build layout (your known issue) |
| T15 | hard | security: block junction/symlink sandbox escapes |
| T16 | medium | plan a project from the PLAN template |
| T17 | medium | exact data transform (JSON to CSV) |
| T18 | easy | summarize project status accurately |

## How grading works

- Every task runs in a fresh copy of the repo in %TEMP%\agent-evals\, so your real repo is never touched.
- Code tasks are checked with hidden tests (evals/hidden/) the agent never sees, so it can't
  just make its own weak tests pass.
- Tasks that touch packages/agent must also keep the existing tests and typecheck green.
- T11 breaks grep on purpose to confirm the agent's tests actually catch the bug.
- T12 adds a failing test on purpose to confirm verify actually fails.

## Levels (what "on par" means)

- 0-5: the agent can only do trivial edits
- 6-11: useful for single-file work; the hard tasks need Hermes
- 12-15: can do most of your roadmap alone
- 16-18: on par with a strong cloud agent on this codebase

Don't let the agent see or edit the evals/ folder: it's excluded from the sandboxes.
