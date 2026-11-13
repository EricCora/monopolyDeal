# Report a Problem, Fixed Automatically

**Status:** Accepted

## Problem
While playing on his phone, Eric notices many things he wants changed, but getting them to Claude means remembering them later, taking screenshots by hand and explaining the game state in a chat. Most of that context is lost on the way, and each fix then waits for him to start a session, review, merge and reinstall.

## Outcome
- A small bug button floats over every screen on iOS and web, shown only when a developer switch in Settings is on. Tapping it captures the screen as it was *before* the sheet opened, then asks for a note.
- Sending creates one report holding: the screenshot, the note, the current game (variant, seed, action log and state, in a form the replay tools can load), the build's git commit, device, orientation, room code if online, and the last few hundred app log lines.
- Within 2 minutes of sending, while the Mac is awake and online, a headless Claude Code session has started on that report in its own worktree.
- That session fixes the issue, runs `npm run quality` (and `npm run ios:verify` for iOS or rule changes), merges to `master` and pushes. It asks Eric only when the note is genuinely ambiguous or the change would alter game rules. The question shows as a red dot on the bug button and in the report list, with a reply box. The Mac also shows a notification. A push notification to the phone while the app is closed is not built, because the free developer account can't send them.
- Once the build is ready, the app shows a "New build ready" banner. Tapping **Install** saves the current game and asks the Mac to install it. The app restarts on the new build and offers to resume the game.
- Each report shows a status Eric can see in the app: received, fixing, needs you, fixed (with commit), or failed (with reason).

## Constraints
- **Confirmed:** the repo is public, so reports (screenshots and notes) must not land in public GitHub issues or public commits.
- **Confirmed:** turn rooms depend on Vercel Blob's free limits, and Blob stops for up to 30 days once a limit is passed. Reports must not share that budget.
- **Confirmed:** a push to `master` deploys web (Vercel) and server (Render). Eric chose merge, push and reinstall after every fix on 2026-11-12. That is his standing permission to push for this pipeline only.
- **Confirmed:** fixes must run on the Mac, because `ios:verify` and phone installs need Xcode.
- **Confirmed:** installs need the Mac awake and the phone reachable (same Wi-Fi or cable). Free profiles expire after about 7 days. Installing over the existing app uses the same bundle id, so the 3-app limit isn't hit.
- **Assumed:** `devicectl` can install over Wi-Fi to a paired phone without Xcode open. Untested: the phone showed as unavailable today.
- **Confirmed:** every change follows the existing rules: its own worktree, a failing test first for a bug, rule changes made in TypeScript first, then traces, then Swift.
- No secrets in the app beyond a report key that can only post reports and read their status.

## Non-goals
- No reports from players other than Eric. The switch is off by default.
- No crash reporting or analytics.
- No hosted fixing: the pipeline stops while the Mac is asleep and catches up on wake.

## Approach
- **Inbox:** a new Vercel Function `/api/feedback`, checked against the report key, writes each report to a **private** GitHub repo (`monopolyDeal-feedback`) through a server-side token. That costs nothing and stays clear of Blob. The same endpoint serves report status and the "build ready" flag.
- **Watcher:** a `launchd` job on the Mac polls the inbox every 30 seconds. For each new report it runs `claude -p` with a fixed prompt in a fresh worktree, one report at a time, then merges, pushes and records the result.
- **Install:** when Eric taps Install, the app sets a flag. The watcher sees it, builds the app and runs `devicectl` install. On launch, the existing active-game save resumes the game.
- **Web:** the same button and sheet. "Install" becomes "Reload" after the deploy.

## Verification
- Unit tests: report building on both platforms, including that the screenshot is taken before the sheet opens and that the snapshot loads in `replay:verify`.
- An end-to-end dry run: send a report from the simulator, then see a session start, a commit land on a test branch, and the status reach "fixed".
- On the real phone: report, fix, banner, Install, then the game resumes on the same turn.
- Not covered automatically: the quality of the fixes themselves, and how well the Wi-Fi install holds up across networks.

## Open questions
- Eric has to create a fine-grained GitHub token (one repo, contents read and write) and add it to Vercel. Only he can do that.
- Should a rule-changing report always stop to ask? Proposed: yes. Eric decides.
- If a fix session fails twice, should it give up and mark the report "failed", or leave it on a branch? Proposed: leave it on a branch and notify him.
