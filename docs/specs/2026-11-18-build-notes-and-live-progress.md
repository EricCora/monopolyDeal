# Build Notes and Live Report Progress

**Status:** Accepted

## Problem
Three gaps in the report pipeline from `2026-11-12-report-and-autofix.md`:
- The "New build ready" banner shows whenever the running build's commit differs from the inbox's latest build. On 2026-11-18 the phone ran `132fe35` (installed from Xcode by another session) and the banner offered the *older* `6291017`. Tapping Install would have downgraded it.
- A build says nothing about what it contains, so Eric can't tell what Install would bring, or what he is running now.
- After sending a report, Eric sees "Received" or "Fixing" at most once a minute, with no sign of how far along the fix is or whether it has stalled.

## Outcome
- The banner shows only when the offered build is newer than the running one. A phone on `132fe35` is never offered `6291017`.
- The New Build sheet lists what's new since the running build, in two groups: **Fixed from your reports** (the report's note and the fix summary) and **Other changes** (commit subjects). Each group shows at most 15 lines, then "and N more".
- Settings shows "This build: `<short commit>`, `<date>`" and the notes from the last install.
- While a report is being fixed, its row shows a phase: Starting, Working on it, Running checks, Running iOS checks, or Merging. (Building for the phone is already shown by the install banner.) It also shows one line on what the agent is doing (for example "Editing HomeView.swift" or "Running npm run quality"), no more than 60 seconds old while the session runs.
- While any report is fixing or an install is running, the app checks every 10 seconds instead of 60.
- All of the above works the same on iOS and web. On web, "Install" stays "Reload".
- When master gains changes to app code (`src/`, `apps/ios/`) that aren't on the phone, the watcher offers a build without waiting for a fix.

## Constraints
- **Confirmed:** every index update is a git commit to the private inbox repo through GitHub. Progress writes must be throttled to no more than 1 per 30 seconds per report.
- **Confirmed:** `runClaude` blocks today (sync `run`). Streaming steps needs a non-blocking child process, and the watcher must still handle one report at a time.
- **Confirmed:** the step line carries only a tool name and a short target (file name, or command name). It never carries tool output, file contents or anything from `config.json`.
- **Confirmed:** builds made outside the watcher (Xcode, `ios:verify` installs) stamp a short hash. The comparison must accept short and full hashes.
- **Confirmed (2026-11-18 test run):** `claude -p --output-format stream-json --verbose` emits the session id first, then one `tool_use` event per action, then a `result`.
- **Confirmed:** a date stamp alone can't place builds made by hand (`132fe35` had none). So the inbox also publishes the last 60 master commits, and an app finds its own commit there first, then falls back to its `DEAL_BUILD_DATE` stamp. Only when neither works is the build offered, as before.

## Non-goals
- No full live transcript or diff in the app. Use the resume command in the watcher log for that.
- No push notifications to the phone.
- No changes to how fixes are made, merged or installed.

## Approach
- The watcher stores `build.commit` (the newest app change on master), `build.committedAt` and `build.log`: the last 60 master commits with date, subject, whether they change the app, and the report each fix commit belongs to.
- Each app places itself in that log (or by date), and works out its own notes from the commits above it. Fixes show with the note Eric wrote.
- Fix sessions switch to `stream-json`. The watcher reads events as they arrive, keeps the latest step, and writes `phase`, `step` and `stepAt` into the report's status on the 30 s throttle. It writes its own phases at the start of quality, ios:verify, merge and install.

## Verification
- Failing tests first, in `src/test/` and the Swift report tests: phone `132fe35` (newer) is not offered `6291017`; an older phone is; short vs full hash matches.
- Unit tests: notes built from a fixed git log (grouping, the 15-line cap); stream events mapped to step lines, with output and secrets dropped; the throttle writes at most once per 30 s.
- On the real phone: send a report, see phase and step lines change within about a minute; after the fix, the sheet lists the fix and other changes; after Install, Settings shows the new commit.
- `npm run quality` and `npm run ios:verify` pass.
- Not covered automatically: whether the step lines are useful to read, and GitHub rate limits under many quick reports.

## Open questions
None. Eric accepted both proposals on 2026-11-18: builds are offered when master changes app code, and the step line shows file names.
