#!/usr/bin/env node
// Watches the private report inbox, runs a headless Claude Code session per report, checks the
// result, merges and pushes to master, and installs new builds on Eric's phone when he asks.
// Runs as a launchd agent: see scripts/feedback/README.md. One step at a time, never two.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  LOG_LENGTH, MAX_ERRORS, buildFromLog, failedTestNames, forbiddenPaths, makeThrottle, needsIosVerify, newFailures, nextWork, parseGitLog,
  parseIosFailures, readResult, stepFromEvent,
} from './plan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.env.FEEDBACK_CONFIG ?? join(homedir(), '.config/monopolydeal-feedback/config.json');
const config = {
  repo: join(homedir(), 'Developer/monopolyDeal'),
  inbox: join(homedir(), 'Library/Application Support/MonopolyDealFeedback/inbox'),
  inboxRemote: 'https://github.com/EricCora/monopolyDeal-feedback.git',
  worktrees: join(homedir(), 'Developer/monopolyDeal-feedback-work'),
  derivedData: join(homedir(), 'Library/Caches/MonopolyDealFeedback/device'),
  bundleId: 'com.ericcora.monopolydeal',
  apiBase: 'https://monopoly-deal-smoky.vercel.app/api/feedback',
  claude: join(homedir(), '.local/bin/claude'),
  pollSeconds: 30,
  fixTimeoutMinutes: 90,
  /** Fewest seconds between two progress writes for one report: each is a commit to the inbox. */
  progressSeconds: 30,
  /** How often an idle watcher checks master for app changes to offer as a build. */
  buildCheckMinutes: 5,
  push: true,
  ...JSON.parse(readFileSync(CONFIG_PATH, 'utf8')),
};
for (const key of ['deviceId', 'reportKey']) {
  if (!config[key]) throw new Error(`${CONFIG_PATH} needs "${key}"`);
}
const ONCE = process.argv.includes('--once');
const DRY = process.argv.includes('--no-push');
if (DRY) config.push = false;

const log = (...parts) => console.log(new Date().toISOString(), ...parts);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: (options.timeoutMinutes ?? 30) * 60_000,
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    input: options.input,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (options.check !== false && result.status !== 0) {
    throw new Error(`${command} ${args.slice(0, 3).join(' ')} failed (${result.status ?? result.signal}): ${output.slice(-1500)}`);
  }
  return { ok: result.status === 0, output, stdout: result.stdout ?? '' };
}
const git = (cwd, ...args) => run('git', ['-C', cwd, ...args]).stdout.trim();

function notify(title, message) {
  run('osascript', ['-e', `display notification ${JSON.stringify(message.slice(0, 200))} with title ${JSON.stringify(title)}`], { check: false });
}

// MARK: Inbox

function pullInbox() {
  if (!existsSync(join(config.inbox, '.git'))) {
    mkdirSync(dirname(config.inbox), { recursive: true });
    run('git', ['clone', '-q', config.inboxRemote, config.inbox]);
  }
  run('git', ['-C', config.inbox, 'pull', '-q', '--rebase']);
}

function readIndex() {
  const path = join(config.inbox, 'index.json');
  const parsed = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  return { reports: parsed.reports ?? {}, build: parsed.build ?? null, install: parsed.install ?? null };
}

/** Changes index.json and pushes it, retrying if a new report arrived in between. */
function updateIndex(change, message) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    pullInbox();
    const index = readIndex();
    change(index);
    writeFileSync(join(config.inbox, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
    run('git', ['-C', config.inbox, 'add', 'index.json']);
    if (!run('git', ['-C', config.inbox, 'diff', '--cached', '--quiet'], { check: false }).ok) {
      run('git', ['-C', config.inbox, 'commit', '-q', '-m', message]);
    }
    if (run('git', ['-C', config.inbox, 'push', '-q'], { check: false }).ok) return index;
    run('git', ['-C', config.inbox, 'reset', '-q', '--hard', '@{u}']);
  }
  throw new Error('could not push the inbox index');
}

/** Progress lines only mean something while a report is being fixed. */
const DONE = { phase: undefined, step: undefined, stepAt: undefined };

function setStatus(id, status) {
  const progress = status.state && status.state !== 'fixing' ? DONE : {};
  return updateIndex((index) => {
    index.reports[id] = { ...index.reports[id], ...progress, ...status, updatedAt: new Date().toISOString() };
  }, `${id}: ${status.state ?? status.phase ?? 'progress'}`);
}

/** Where a fix has got: one of the PHASE_LABELS in src/ui/report/buildNotes.ts. */
function setPhase(id, phase) {
  setStatus(id, { phase, step: undefined, stepAt: undefined });
}

const listDir = (path) => (existsSync(path) ? readdirSync(path).filter((name) => !name.startsWith('.')) : []);

function scanInbox() {
  const reportIds = listDir(join(config.inbox, 'reports'));
  const platforms = {};
  const replies = {};
  for (const id of reportIds) {
    try {
      platforms[id] = JSON.parse(readFileSync(join(config.inbox, 'reports', id, 'report.json'), 'utf8')).platform;
    } catch {
      platforms[id] = 'unknown';
    }
    replies[id] = listDir(join(config.inbox, 'reports', id, 'replies'));
  }
  const installRequests = listDir(join(config.inbox, 'control/install-requests')).map((name) => name.replace(/\.json$/, ''));
  return { reportIds, platforms, replies, installRequests };
}

// MARK: Fixing

const worktreeFor = (id) => join(config.worktrees, `fix-${id}`);
const branchFor = (id) => `fix/report-${id}`;

function prepareWorktree(id) {
  const path = worktreeFor(id);
  const branch = branchFor(id);
  mkdirSync(config.worktrees, { recursive: true });
  git(config.repo, 'fetch', '-q', 'origin', 'master');
  if (existsSync(path)) run('git', ['-C', config.repo, 'worktree', 'remove', '--force', path], { check: false });
  git(config.repo, 'worktree', 'add', '-q', '-B', branch, path, 'origin/master');
  // Clone node_modules (copy-on-write) when the lock file matches, otherwise install fresh.
  const sameLock = existsSync(join(config.repo, 'node_modules'))
    && readFileSync(join(config.repo, 'package-lock.json'), 'utf8') === readFileSync(join(path, 'package-lock.json'), 'utf8');
  if (!sameLock || !run('cp', ['-cR', join(config.repo, 'node_modules'), join(path, 'node_modules')], { check: false }).ok) {
    run('npm', ['ci', '--silent'], { cwd: path, timeoutMinutes: 15 });
  }
  const reportDir = join(path, '.feedback', id);
  cpSync(join(config.inbox, 'reports', id), reportDir, { recursive: true });
  return { path, branch, reportDir };
}

/**
 * Runs the fix session, streaming its events so the app can show what it's doing. Resolves when
 * the session exits, with its id (known from the first event) and its final reply.
 */
function runClaude(id, cwd, prompt, sessionId) {
  const args = ['-p', prompt, '--permission-mode', 'auto', '--output-format', 'stream-json', '--verbose'];
  if (sessionId) args.push('--resume', sessionId);
  log('claude', sessionId ? `resuming ${sessionId}` : 'starting', 'in', cwd);
  setPhase(id, 'working');
  return new Promise((resolve) => {
    const child = spawn(config.claude, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let current = sessionId;
    let text = '';
    let stderr = '';
    let savedSession = Boolean(sessionId);
    const throttle = makeThrottle((step) => {
      try {
        setStatus(id, { step, stepAt: new Date().toISOString() });
      } catch (error) {
        log(id, 'progress write failed:', error.message);
      }
    }, config.progressSeconds * 1000);
    const ticker = setInterval(() => throttle.tick(), 5000);
    const timeout = setTimeout(() => {
      log(id, `claude ran past ${config.fixTimeoutMinutes} minutes, stopping it`);
      child.kill('SIGTERM');
    }, config.fixTimeoutMinutes * 60_000);
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });
    createInterface({ input: child.stdout }).on('line', (line) => {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.session_id) current = event.session_id;
      // Saved straight away, so a watcher restart can resume this session.
      if (current && !savedSession) {
        savedSession = true;
        setStatus(id, { sessionId: current });
      }
      if (event.type === 'result' && typeof event.result === 'string') text = event.result;
      const step = stepFromEvent(event);
      if (step) throttle.push(step);
    });
    child.on('close', (code) => {
      clearInterval(ticker);
      clearTimeout(timeout);
      if (code !== 0) log(id, `claude exited ${code}:`, stderr.slice(-800));
      resolve({ sessionId: current, text });
    });
    child.on('error', (error) => {
      clearInterval(ticker);
      clearTimeout(timeout);
      log(id, 'claude failed to start:', error.message);
      resolve({ sessionId: current, text: '' });
    });
  });
}

function takeResult(reportDir) {
  const path = join(reportDir, 'result.json');
  if (!existsSync(path)) return readResult(null);
  let parsed = null;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    parsed = null;
  }
  rmSync(path);
  return readResult(parsed);
}

/** The fix's own commits, recorded before the push so the build notes can list them under the report. */
let shippedCommits = [];

/** Checks the fix the way CI would, then merges and pushes. Returns null, or what went wrong. */
function verifyAndShip(id, path) {
  git(path, 'fetch', '-q', 'origin', 'master');
  const ahead = git(path, 'rev-list', '--count', 'origin/master..HEAD');
  if (ahead === '0') return 'The session committed no changes.';
  const dirty = git(path, 'status', '--porcelain', '--', '.', ':!.feedback');
  if (dirty) return `Uncommitted changes were left behind:\n${dirty}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!run('git', ['-C', path, 'rebase', '-q', 'origin/master'], { check: false }).ok) {
      run('git', ['-C', path, 'rebase', '--abort'], { check: false });
      return 'The change no longer applies on top of master (a rebase conflict). Rebase onto origin/master and resolve it.';
    }
    const changed = git(path, 'diff', '--name-only', 'origin/master...HEAD').split('\n').filter(Boolean);
    const forbidden = forbiddenPaths(changed);
    if (forbidden.length) return `The branch commits report files, which must never reach the public repo: ${forbidden.join(', ')}. Remove them from the commits.`;
    setPhase(id, 'checks');
    let quality = run('npm', ['run', 'quality'], { cwd: path, check: false, timeoutMinutes: 30 });
    // Timing tests can fail while the Mac is busy, so one retry before blaming the change.
    if (!quality.ok) quality = run('npm', ['run', 'quality'], { cwd: path, check: false, timeoutMinutes: 30 });
    if (!quality.ok) return `npm run quality failed:\n${quality.output.slice(-3000)}`;
    if (needsIosVerify(changed)) {
      setPhase(id, 'ios_checks');
      const problem = iosGate(path);
      if (problem) return problem;
    }
    if (!config.push) {
      log('--no-push: verified, not pushing');
      return null;
    }
    setPhase(id, 'merging');
    shippedCommits = git(path, 'rev-list', '--abbrev-commit', 'origin/master..HEAD').split('\n').filter(Boolean);
    if (run('git', ['-C', path, 'push', '-q', 'origin', 'HEAD:master'], { check: false }).ok) return null;
    git(path, 'fetch', '-q', 'origin', 'master');
  }
  return 'Could not push to master after three tries.';
}

/**
 * Runs ios:verify. UI tests that fail are run again once, and any still failing are run on
 * master too: only failures master doesn't share block the fix.
 */
function iosGate(path) {
  const full = run('npm', ['run', 'ios:verify'], { cwd: path, check: false, timeoutMinutes: 90 });
  if (full.ok) return null;
  const failures = parseIosFailures(full.output);
  if (!failures) return `npm run ios:verify failed before the UI tests:\n${full.output.slice(-3000)}`;
  const recheck = (dir, tests) => {
    const result = run('node', ['scripts/ios_verify.mjs', '--only', tests.join(',')], { cwd: dir, check: false, timeoutMinutes: 60 });
    return result.ok ? {} : parseIosFailures(result.output) ?? { all: ['*'] };
  };
  const named = failedTestNames(failures).filter((test) => test !== '*');
  if (named.length !== failedTestNames(failures).length) return `npm run ios:verify failed without naming tests:\n${full.output.slice(-3000)}`;
  const still = recheck(path, named);
  if (!Object.keys(still).length) {
    log('ios:verify: failures passed on a rerun:', named.join(', '));
    return null;
  }
  const base = join(config.worktrees, 'baseline');
  if (!existsSync(base)) git(config.repo, 'worktree', 'add', '-q', '--detach', base, 'origin/master');
  else git(base, 'checkout', '-q', '--detach', '-f', 'origin/master');
  if (!existsSync(join(base, 'node_modules'))) run('npm', ['ci', '--silent'], { cwd: base, timeoutMinutes: 15 });
  const onMaster = recheck(base, failedTestNames(still));
  const fresh = newFailures(still, onMaster);
  if (!Object.keys(fresh).length) {
    log('ios:verify: these also fail on master, so they don\'t block:', JSON.stringify(still));
    return null;
  }
  return `npm run ios:verify has UI tests that fail on this branch but pass on master: ${JSON.stringify(fresh)}\n${full.output.slice(-2500)}`;
}

function cleanUp(id) {
  run('git', ['-C', config.repo, 'worktree', 'remove', '--force', worktreeFor(id)], { check: false });
  run('git', ['-C', config.repo, 'branch', '-D', branchFor(id)], { check: false });
}

/** Runs (or resumes) the session until it fixes, asks, or gives up. */
async function driveFix(id, { path, branch, reportDir }, firstPrompt, sessionId) {
  let prompt = firstPrompt;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const session = await runClaude(id, path, prompt, sessionId);
    sessionId = session.sessionId;
    setStatus(id, { state: 'fixing', sessionId, branch });
    const result = takeResult(reportDir);
    log(id, 'session result:', result.outcome, `(resume: mkdir -p ${path} && cd ${path} && claude --resume ${sessionId})`, '-', result.summary.slice(0, 200));
    if (result.outcome === 'needs_you') {
      const seen = listDir(join(config.inbox, 'reports', id, 'replies'));
      setStatus(id, { state: 'needs_you', question: result.question, summary: result.summary, sessionId, repliesSeen: seen });
      notify('Monopoly Deal: question for you', result.question ?? result.summary);
      return;
    }
    if (result.outcome === 'no_change') {
      setStatus(id, { state: 'no_change', summary: result.summary, sessionId });
      cleanUp(id);
      return;
    }
    if (result.outcome === 'failed') {
      setStatus(id, { state: 'failed', summary: result.summary, sessionId });
      notify('Monopoly Deal: fix failed', result.summary);
      return;
    }
    const problem = verifyAndShip(id, path);
    if (!problem) {
      const commit = git(path, 'rev-parse', 'HEAD');
      const commits = config.push ? shippedCommits : [];
      updateIndex((index) => {
        index.reports[id] = { ...index.reports[id], ...DONE, state: 'fixed', summary: result.summary, commit, commits, question: undefined, updatedAt: new Date().toISOString() };
      }, `${id}: fixed in ${commit.slice(0, 8)}`);
      // A dry run's commit was never pushed, so there's no build to offer.
      if (config.push) refreshBuild();
      log(id, 'fixed and', config.push ? `pushed ${commit.slice(0, 8)}` : 'verified (not pushed)');
      notify('Monopoly Deal: fixed', result.summary);
      if (config.push) cleanUp(id);
      return;
    }
    log(id, 'verification problem:', problem.slice(0, 400));
    prompt = `The watcher checked your work and it can't merge yet:\n\n${problem}\n\nFix this on the same branch, commit, and write result.json again.`;
  }
  setStatus(id, { state: 'failed', summary: 'The fix kept failing its checks. The work is kept on its branch.', sessionId, branch });
  notify('Monopoly Deal: fix failed', `Report ${id} kept failing its checks.`);
}

async function handleReport(id, resume) {
  const existing = readIndex().reports[id];
  if (resume && existing?.sessionId && existsSync(worktreeFor(id))) {
    const reportDir = join(worktreeFor(id), '.feedback', id);
    await driveFix(id, { path: worktreeFor(id), branch: branchFor(id), reportDir },
      'The watcher restarted while you were working. Carry on from where you were, then write result.json.', existing.sessionId);
    return;
  }
  setStatus(id, { state: 'fixing', phase: 'starting' });
  const place = prepareWorktree(id);
  const prompt = readFileSync(join(HERE, 'fix-prompt.md'), 'utf8')
    .replaceAll('{{REPORT_DIR}}', place.reportDir)
    .replaceAll('{{BRANCH}}', place.branch);
  await driveFix(id, place, prompt, null);
}

async function handleReply(id, replyNames) {
  const status = readIndex().reports[id];
  const texts = replyNames.map((name) => JSON.parse(readFileSync(join(config.inbox, 'reports', id, 'replies', name), 'utf8')).text);
  setStatus(id, { state: 'fixing', phase: 'starting', question: undefined, repliesSeen: [...(status.repliesSeen ?? []), ...replyNames] });
  const path = worktreeFor(id);
  const place = existsSync(path) ? { path, branch: branchFor(id), reportDir: join(path, '.feedback', id) } : prepareWorktree(id);
  const prompt = `Eric answered your question ("${status.question ?? ''}"):\n\n${texts.join('\n\n')}\n\nCarry on with the fix, then write result.json again.`;
  await driveFix(id, place, prompt, status.sessionId);
}

// MARK: Installing

function phoneReachable() {
  const listing = run('xcrun', ['devicectl', 'list', 'devices'], { check: false }).output;
  const line = listing.split('\n').find((row) => row.includes(config.deviceId)) ?? '';
  return /\b(available|connected)\b/.test(line) && !/unavailable/.test(line);
}

function handleInstall(request, retry) {
  const index = readIndex();
  if (!phoneReachable()) {
    const since = retry && index.install?.since ? index.install.since : new Date().toISOString();
    const hours = (Date.now() - Date.parse(since)) / 3_600_000;
    const state = hours > 6 ? 'failed' : 'waiting';
    updateIndex((next) => {
      next.install = { state, request, since, at: new Date().toISOString(), message: state === 'failed' ? 'Your phone never came in range of the Mac. Tap Install again.' : 'Waiting for your phone to be on the same Wi-Fi as the Mac (or plugged in).' };
    }, `install ${state}`);
    if (!retry || state === 'failed') notify('Monopoly Deal install', state === 'failed' ? 'Gave up waiting for the phone.' : 'Waiting for your phone to be on the same Wi-Fi.');
    return;
  }
  updateIndex((next) => {
    next.install = { state: 'installing', request, at: new Date().toISOString() };
  }, 'install started');
  try {
    const path = join(config.worktrees, 'install');
    mkdirSync(config.worktrees, { recursive: true });
    git(config.repo, 'fetch', '-q', 'origin', 'master');
    if (!existsSync(path)) git(config.repo, 'worktree', 'add', '-q', '--detach', path, 'origin/master');
    else git(path, 'checkout', '-q', '--detach', '-f', 'origin/master');
    const commit = git(path, 'rev-parse', 'HEAD');
    const committedAt = git(path, 'log', '-1', '--format=%cI');
    run('xcodebuild', [
      '-project', 'MonopolyDeal.xcodeproj', '-scheme', 'MonopolyDeal', '-configuration', 'Release',
      '-destination', 'generic/platform=iOS', '-derivedDataPath', config.derivedData, '-allowProvisioningUpdates', '-quiet', 'build',
      `DEAL_BUILD_COMMIT=${commit}`, `DEAL_BUILD_DATE=${committedAt}`, `DEAL_REPORT_KEY=${config.reportKey}`, `DEAL_REPORT_API=${config.apiBase}`,
    ], { cwd: join(path, 'apps/ios'), timeoutMinutes: 30 });
    const app = join(config.derivedData, 'Build/Products/Release-iphoneos/MonopolyDeal.app');
    run('xcrun', ['devicectl', 'device', 'install', 'app', '--device', config.deviceId, app], { timeoutMinutes: 10 });
    run('xcrun', ['devicectl', 'device', 'process', 'launch', '--device', config.deviceId, config.bundleId], { check: false, timeoutMinutes: 2 });
    updateIndex((next) => {
      next.install = { state: 'installed', request, commit, committedAt, at: new Date().toISOString() };
    }, `installed ${commit.slice(0, 8)}`);
    refreshBuild();
    notify('Monopoly Deal', 'New build installed on your phone.');
  } catch (error) {
    log('install failed', error.message);
    updateIndex((next) => {
      next.install = { state: 'failed', request, at: new Date().toISOString(), message: error.message.slice(0, 400) };
    }, 'install failed');
    notify('Monopoly Deal install failed', error.message.slice(0, 160));
  }
}

// MARK: Builds

let lastBuildCheck = 0;

/**
 * Offers the newest app change on master as a build, with the recent log the apps use to place
 * themselves and list what's new. Writes only when the offered commit or its fixes change.
 */
function refreshBuild() {
  lastBuildCheck = Date.now();
  // Never lets a failure here undo the fix or install that called it: the next check retries.
  try {
    offerBuild();
  } catch (error) {
    log('build check failed:', error.message);
  }
}

function offerBuild() {
  git(config.repo, 'fetch', '-q', 'origin', 'master');
  const raw = git(config.repo, 'log', `-${LOG_LENGTH}`, '--format=%x1e%h%x09%cI%x09%s', '--name-only', 'origin/master');
  const entries = parseGitLog(raw);
  const index = readIndex();
  const installed = index.install?.commit ?? '';
  // Fixed reports not on the phone yet, for older apps that only count these.
  const installedAt = entries.findIndex((entry) => installed.startsWith(entry.commit));
  const newer = new Set((installedAt >= 0 ? entries.slice(0, installedAt) : entries).map((entry) => entry.commit));
  const pending = Object.entries(index.reports)
    .filter(([, status]) => status.state === 'fixed' && (status.commits ?? []).some((commit) => newer.has(commit.slice(0, 7))))
    .map(([id]) => id);
  const next = buildFromLog(entries, index.reports, pending);
  if (!next) return;
  const same = index.build?.commit === next.commit && JSON.stringify(index.build?.reports ?? []) === JSON.stringify(pending)
    && JSON.stringify(index.build?.log ?? []) === JSON.stringify(next.log);
  if (same) return;
  updateIndex((latest) => {
    latest.build = { ...next, at: new Date().toISOString() };
  }, `build ${next.commit}`);
  log('build offered:', next.commit, pending.length ? `with fixes ${pending.join(', ')}` : '');
}

// MARK: Loop

async function step() {
  pullInbox();
  const work = nextWork(readIndex(), scanInbox());
  if (!work) {
    if (config.push && Date.now() - lastBuildCheck > config.buildCheckMinutes * 60_000) refreshBuild();
    return false;
  }
  log('work:', JSON.stringify(work));
  if (work.kind === 'install') {
    handleInstall(work.request, work.retry);
    return !work.retry;
  }
  try {
    if (work.kind === 'reply') await handleReply(work.id, work.replies);
    else await handleReport(work.id, work.resume);
  } catch (error) {
    // Without this, a fix that hits the same error would be resumed every 30 seconds forever.
    const errors = (readIndex().reports[work.id]?.errors ?? 0) + 1;
    log(work.id, `error ${errors} of ${MAX_ERRORS}:`, error.message);
    if (errors >= MAX_ERRORS) {
      setStatus(work.id, { state: 'failed', errors, summary: `The watcher hit an error and stopped: ${error.message.slice(0, 300)}` });
      notify('Monopoly Deal: fix stopped', error.message.slice(0, 160));
    } else {
      setStatus(work.id, { state: 'fixing', errors });
    }
  }
  return true;
}

const lock = join(dirname(config.inbox), 'watcher.pid');
mkdirSync(dirname(lock), { recursive: true });
if (existsSync(lock)) {
  const pid = Number(readFileSync(lock, 'utf8'));
  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch {
    alive = false;
  }
  if (alive && pid !== process.pid) {
    log(`another watcher is running (pid ${pid})`);
    process.exit(0);
  }
}
writeFileSync(lock, String(process.pid));
process.on('exit', () => rmSync(lock, { force: true }));
process.on('SIGTERM', () => process.exit(0));

log('watching', config.inboxRemote, config.push ? '' : '(no push)');
for (;;) {
  let busy = false;
  try {
    busy = await step();
  } catch (error) {
    log('step failed:', error.message);
  }
  if (ONCE) break;
  if (!busy) await new Promise((resolve) => setTimeout(resolve, config.pollSeconds * 1000));
}
