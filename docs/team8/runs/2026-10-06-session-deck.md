# Run log — session-deck

spec: docs/team8/specs/2026-10-06-session-deck-design.md
plan: docs/team8/plans/2026-10-06-session-deck.md
branch: none (not a git repo)
pr: none (not a git repo)

## Brainstorm
- path: architectural
- spec rounds with the user: 9 (v1 scope, foundation, terminal ×2, SDK sessions, approach, scope widened to the whole handoff, plan usage, Ask) + 3 section approvals

## Plan
- plan: written by the lead · self-review fixes: 4 (writeJsonAtomic missing from two interface blocks; spec prompt caps 50×500 → 30×300 to match the plan; spec layout synced with plan files; spec "tee when fresher" made explicit as "for live sessions")
- tasks: 15 · tracks: 6 (A main, B shared logic, R renderer foundation + sidebar, D list + detail, F command bar, Z composition + packaging) · waves: 4 · peak: 5 at once · mode: teammates — tracks A, B, R, D and F overlap in waves 2–3 with disjoint files
- estimate: ≈$45.45 (5 opus tasks: 1, 4, 5, 6, 14; 10 sonnet tasks), before track reviews

## Run
- first dispatch 2026-10-06T12:36Z · last track cleared ≈13:17Z (≈41 min wall)
- executors · peak 5 at once:
  - track-a · opus · high · track A · wave 1
  - track-b · sonnet · high · track B · wave 2
  - track-r · sonnet · medium · track R · wave 2
  - track-d · sonnet · medium · track D · wave 3
  - track-f · sonnet · high · track F · wave 3
  - track-z · opus · high · track Z · wave 4
- track reviews: R 1/3 · B 1/3 · D 1/3 · F 1/3 · A 2/3 · Z 2/3
  - A round 1: B1 (control characters in cwd typed into iTerm/Terminal) Blocking. The lead promoted M3 (boolean IPC args), M4 (openFolder must not launch bundles), M5 (will-navigate guard), M6 (one EACCES stalled every scan), M9 (control characters in titles), M10 (uncapped cached prompt), and T1 (launch-test timeout 120 s).
  - Z round 1: two Blocking issues in the plan's own App.tsx: B1 (stale `bar` in `fail` hid resume errors) and B2 (a dismissed "Resume in" left a pending resume that a later Change terminal would run). Promoted m1–m4 (clipboard rejection, launch error shown, order-insensitive selection key, pure updater).
- residuals: 11, all Minor and not fixed
  - A-M1: writing `~/.claude/settings.json` replaces a symlink and resets its mode. The user's file is a regular file.
  - A-M2: the tee pipes stdin only to the first part of a compound status-line command (`a && b`). The user's is a single command.
  - A-M7: no watcher if `~/.claude/projects` or `~/.claude/sessions` doesn't exist at launch.
  - A-M8: a reused pid makes a dead session look live.
  - A-M11: indexer tests don't prove append-only parsing; there is no multibyte chunk-boundary test; `appendLine` is untested.
  - A-r2: `folderToOpen` TOCTOU, with `statSync` outside its try (raw ENOENT).
  - A-r2: bundle types other than `.app` (`.prefPane`, `.workflow`…) still open.
  - A-r2: the prompt-cap test hard-codes 300 instead of `PROMPT_CHARS`.
  - Z-r2: one Esc in "Resume in" keeps `bar.pending` alive inside the same bar. A fix needs an `onKind` prop from CommandBar.
  - Z-r2: no tests for the bar-state transitions (no DOM test library is pinned).
  - R: sidebar rows aren't keyboard-operable, as in the prototype.
- verification: lead's full suite 120 passed / 2 gated skips · both typechecks clean · build ok with test code stripped · `dist/mac-arm64/Session Deck.app` re-packaged 10:11 local, after the last source change, with `codesign --verify --deep --strict` ok, Apple Development identity, hardened runtime, apple-events entitlement.
- real-data results:
  - smoke test: sessions=457, hidden=185, repos=10, cold 3.0 s, warm 15–21 ms;
  - dev app: 272 visible sessions; the 7-item manual check all PASS;
  - packaged app: lists 272 and resumes in iTerm with no Automation prompt.
- actual: ≈$85.05 in all.
  - lead ≈$49.95 (brainstorm, a 6.4k-line plan, the run);
  - executors ≈$28.11: track-a ≈$12.18, track-z ≈$12.17, track-b ≈$1.32, track-d ≈$0.93, track-f ≈$0.76, track-r ≈$0.75;
  - reviewers ≈$6.99 across 8 reviews (A r1 ≈$2.55, Z r1 ≈$1.09, the others ≈$0.27–0.72).
- message lag: median 0.0 min, p90 1.4, max 3.4 · review tails: none · idle with work waiting: none.
- estimate vs actual: executors ≈$28 against ≈$45.45 estimated. Full code in the plan made most tasks transcription. The two opus tracks (A, Z) were ≈87% of executor cost; sonnet tracks ran $0.75–1.32 against $1.15–1.50 estimates.
- went wrong / change next time:
  - **Plan defects:**
    - Detail.tsx's import list omitted `tiles`;
    - straight vs curly quotes in search.ts and CommandBar.tsx;
    - the 30 s launch-test timeout;
    - App.tsx's stale-closure `fail` and the ref-held pending resume, both shipped by the plan and caught only in review.

    Next time, the lead should run the plan's own code mentally against its tests for imports and closures.
  - **Security gap:** the plan quoted for the shell but missed that `write text`/`do script` type into a TTY, where control characters act before quoting. Add "typed into a terminal" to the trust-boundary checklist.
  - **Wrong expectation:** dev and packaged share userData (both named by productName). The plan said the packaged app would ask for a terminal again.
  - **Bundle size:** the 1.25 MB renderer bundle likely carries `react-dom/server`, statically imported by components for their in-source tests. Use `await import` inside test blocks for renderer-only (ESM) files, or check the bundle in Task 14.
  - **Shell quoting:** zsh doesn't word-split `$var`. The lead's diff loop failed once harmlessly; use `bash -c` from the start.
  - **Privacy:** track-a's full-screen screenshot caught the user's Slack window (deleted). Executors should capture single windows (`screencapture -l <windowid>`), never the full screen.
  - **Task list:** all task files vanished once all 15 completed, so track Z's round-1 results live only in its report. Record the final `verified` before the last completion.
  - **No git:** no branch, commits or PR. Reviews diffed against /dev/null and per-round snapshots in the scratchpad.
