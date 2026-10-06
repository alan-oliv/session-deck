# Run log — session-detail-transcript

spec: docs/team8/specs/2026-10-06-session-detail-transcript-design.md
plan: docs/team8/plans/2026-10-06-session-detail-transcript.md
branch: session-detail-transcript
pr: https://github.com/alan-oliv/session-deck/pull/1

## Brainstorm
- path: architectural
- spec rounds with the user: 6 (markdown depth, data approach, 4 section approvals) + spec approved as written

## Plan
- plan: written by the lead · self-review fixes: 5 (Api methods moved from Task 1 to Task 4 so the typecheck stays green between tracks; a diff line-number expectation in the Task 3 tests; a meaningless assertion and a misleading test name in Task 4; the spec's Transcript root class and Focus test synced with the plan)
- tasks: 10 · tracks: 4 (A main + contract, B pure shared logic, C renderer layout + detail, D transcript component) · waves: 4 · peak: 3 at once · mode: teammates — tracks A, B and C share wave 2 with disjoint files
- estimate: ≈$28.45 (3 opus tasks: 3, 8, 10; 6 sonnet; 1 haiku)

## Run
- first dispatch 2026-10-06T18:55Z · last track cleared ≈19:40Z (≈45 min wall)
- executors · peak 3 at once (A, B, C in wave 2):
  - track-a · opus · high · track A (tasks 1–4) · wave 1
  - track-b · sonnet · medium · track B (tasks 5–6) · wave 1
  - track-c · opus · high · track C (tasks 7, 9, 10) · wave 2
  - track-d · opus · high · track D (task 8) · wave 3
- track reviews: A 2/3 · B 1/3 · C 2/3 · D 2/3 · residuals: 3, all Minor and not fixed
  - A round 1: no Blocking. Promoted three Minor (store tests that did not exercise the cache or eviction, helpers duplicated from transcript.ts, ponytail comments without an upgrade path) plus a cross-track catch: a Write that creates a file has an empty `structuredPatch` in real session files, so Write rows showed no diff. Fixed in the reducer with a test; spec §3 updated.
  - B round 1: no Blocking. The lead sent task 6 back once before review: the plan's test expected "6 steps" for a turn with 5 tool calls (the lead's miscount) and the executor bent the formula to fit; reverted to "every tool call is a step" and the test corrected.
  - D round 1: two Blocking from the plan's own code: the older-turn scroll restore double-shifted against Chromium's scroll anchoring, and ordered lists split by a code block restarted at 1 (custom CSS counter ignored `start`). Four Minor promoted (leading list offset, lazy-load double fetch and Expand-all case, Resume tooltip, PR link box style).
  - C round 1: one Blocking from the plan's CSS: `.detail-tabs > *` made the tab bar's spacer no-drag, leaving almost nothing to grab the window by in focus. Three Minor promoted (a results-column drag released outside the command bar closed it, derived focus hid the panes under a click, a duplicated App test). Two executor departures accepted: re-clamping stored pane widths on window resize (the plan never did, and the detail pane measured 112px at 1000px), and leaving focus when nothing is selected.
  - residuals: transcript controls are clickable spans and divs, not keyboard-operable (same convention as the rest of the app and the prototype); `npm install` printed an audit warning for the two new packages, not fixed; a physical window drag by the tab bar was not exercised (no Accessibility permission for synthetic events), only the CSS drag regions were checked.
- verification: lead's full suite 27 files, 167 passed, 2 env-gated skips · typecheck exit 0 · build ok, no test code in `out/` · renderer bundle 1,658 kB (was 1,258 kB on main; react-markdown + remark-gfm) · task 10's 15-point checklist all PASS on the built app, including a live `claude` session (pinned scrolling, hold at 151px up, "Session ended" 2 s after /exit) and the five largest local sessions (150 MB opens in 910 ms, 1,177 items).
- actual: ≈$108.45 in all.
  - lead ≈$58.46 (brainstorm, plan, run);
  - executors ≈$40.86: track-c ≈$25.49, track-a ≈$10.19, track-d ≈$3.73, track-b ≈$1.45;
  - reviewers ≈$9.13 across 7 reviews (review-d ≈$3.10, review-c ≈$2.94, review-a ≈$2.67, review-b ≈$0.42).
- message lag: median 0.0 min, p90 0.9, max 21.2 (two lead→track-c messages waited while it drove the built app through the checklist) · review tails: A 9.4 min · idle with work waiting: none.
- estimate vs actual: executors ≈$41 against ≈$28.45 estimated; track C alone was ≈$25 against ≈$9.90 for its three tasks, almost all of it the verification task driving Electron against real sessions. The other three tracks came in at or under estimate.
- went wrong / change next time:
  - **Plan defects caught by review:** the "6 steps" miscount (twice in the plan), the scroll-anchor double shift, the CSS list counter, the no-drag spacer, no re-clamp on window resize. Four of five are browser-behaviour facts, not transcription errors; next time, state in the plan which browser behaviours a UI step relies on, so the executor checks them in Electron before committing.
  - **Executor bent a formula to fit a wrong test** (track B). The dispatch prompt should say: when a plan test and the spec disagree, stop and ask, never change the rule to match the number.
  - **Real-data gap:** the spec assumed Write results carry a patch; created files do not. Sample the real records for every mapping row during brainstorming, not just the common ones.
  - **Reports truncated** at the mailbox limit three times; ask executors to cap the idle report and send checklists in short chunks.
  - **Scratch sessions in real data:** the verification left two test `claude` sessions under `~/.claude/projects` (shown as a "live-repo" repository). Have the checklist say where to create them and to delete them afterwards, or run them against a temporary `CLAUDE_CONFIG_DIR`.
