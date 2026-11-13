/**
 * The iOS app's verification command: `npm run ios:verify`
 *
 *  1. Swift package tests: conformance with the TypeScript engine, 4,000 fuzzed games,
 *     saves, stats, bots, and full online matches against a real room server.
 *  2. The app builds for the simulator.
 *  3. UI tests play games through the screen on iPhone and iPad.
 *
 * `--skip-ui` leaves out step 3. `--only Class/method,Class/method` runs just those UI tests
 * (and skips step 1), to recheck failures. UI tests run on every device even after one fails,
 * and the last line names the failures: `IOS_VERIFY_UI_FAILURES {"<device>": ["Class/method"]}`,
 * with "*" when a run failed without naming tests. Build output stays out of the repo, because
 * this folder may sync to iCloud.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const ios = join(root, 'apps/ios');
// Per checkout, so agents working in other worktrees don't share build output or a server.
const checkoutId = createHash('sha256').update(root).digest();
const cache = join(homedir(), 'Library/Caches/MonopolyDealBuild', checkoutId.toString('hex').slice(0, 8));
const port = Number(process.env.DEAL_VERIFY_PORT ?? 8700 + (checkoutId[0] % 200));
const serverUrl = `http://localhost:${port}`;
const skipUi = process.argv.includes('--skip-ui');
const onlyIndex = process.argv.indexOf('--only');
const onlyTests = onlyIndex >= 0 ? (process.argv[onlyIndex + 1] ?? '').split(',').filter(Boolean) : [];
const developerDir = '/Applications/Xcode.app/Contents/Developer';
const directSimctl = '/Library/Developer/PrivateFrameworks/CoreSimulator.framework/Versions/A/Resources/bin/simctl';

function step(title) {
  console.log(`\n=== ${title}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    console.error(`\nFAILED: ${command} ${args.join(' ')}`);
    stopServer();
    process.exit(result.status ?? 1);
  }
}

let server;
function stopServer() {
  server?.kill();
}

async function startServer() {
  server = spawn('node', ['--import', 'tsx/esm', 'apps/server/src/index.ts'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), MULTIPLAYER_ROOM_CREATION_MAX_PER_WINDOW: '1000' },
    stdio: 'ignore',
  });
  // A folder that syncs to iCloud can take a while to load files it has offloaded.
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      const response = await fetch(`${serverUrl}/api/multiplayer/health`);
      if (response.ok) return;
    } catch {
      // Still starting.
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error('The room server did not start within 2 minutes.');
}

/** Xcode can't use a simulator until its CoreSimulator component is current. */
function checkSimulatorSetup() {
  const result = spawnSync('xcodebuild', ['-project', 'MonopolyDeal.xcodeproj', '-scheme', 'MonopolyDeal', '-showdestinations'], {
    cwd: ios,
    encoding: 'utf8',
    timeout: 120_000,
  });
  const output = `${result.stdout}${result.stderr}`;
  if (output.includes('CoreSimulator is out of date')) {
    console.error('\nUI tests can\'t run: Xcode needs a newer simulator component. Install it with:');
    console.error('\n  sudo xcodebuild -runFirstLaunch\n');
    console.error('Then run this again. `npm run ios:verify -- --skip-ui` skips the UI tests.');
    stopServer();
    process.exit(1);
  }
}

function simulatorId(deviceName) {
  const result = spawnSync(directSimctl, ['list', 'devices', 'available', '-j'], {
    encoding: 'utf8',
    env: { ...process.env, DEVELOPER_DIR: developerDir },
  });
  const devices = JSON.parse(result.stdout).devices;
  const runtimes = Object.keys(devices).filter((name) => name.includes('iOS-27')).sort().reverse();
  for (const runtime of runtimes) {
    const device = devices[runtime].find((candidate) => candidate.name === deviceName);
    if (device) return device.udid;
  }
  throw new Error(`No iOS 27 simulator named ${deviceName}.`);
}

process.on('exit', stopServer);

step('Starting a room server');
await startServer();

/** "Failing tests:" lists entries like "\tPlaytestRoundTests.testX()". */
function failingTests(output) {
  const block = output.split('Failing tests:')[1];
  if (!block) return [];
  return block.split('\n').map((line) => line.trim()).filter((line) => /^\w+\.\w+\(\)$/.test(line))
    .map((line) => line.replace('()', '').replace('.', '/'));
}

if (onlyTests.length === 0) step('Swift package tests');
if (onlyTests.length === 0) run('swift', ['test', '-c', 'release', '-Xswiftc', '-enable-testing', '--scratch-path', join(cache, 'dealkit-release')], {
  cwd: join(ios, 'DealKit'),
  env: { ...process.env, DEAL_TEST_SERVER_URL: serverUrl, DEAL_REPO_ROOT: root },
});

step('App build');
run('xcodebuild', ['-project', 'MonopolyDeal.xcodeproj', '-scheme', 'MonopolyDeal', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', join(cache, 'dd'), 'build-for-testing', 'CODE_SIGNING_ALLOWED=NO', '-quiet'], { cwd: ios });

if (skipUi) {
  console.log('\nSkipped: UI tests (--skip-ui).');
} else {
  step('UI tests');
  checkSimulatorSetup();
  const failures = {};
  for (const device of ['iPhone 18 Pro Max', 'iPad Pro 13-inch (M5)']) {
    console.log(`\n--- ${device}`);
    const only = onlyTests.map((test) => `-only-testing:MonopolyDealUITests/${test}`);
    const result = spawnSync('xcodebuild', ['-project', 'MonopolyDeal.xcodeproj', '-scheme', 'MonopolyDeal', '-destination', `id=${simulatorId(device)}`, '-derivedDataPath', join(cache, 'dd'), 'test', '-quiet', ...only], {
      cwd: ios,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, TEST_RUNNER_DEAL_TEST_SERVER_URL: serverUrl },
    });
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    if (result.status !== 0) {
      const names = failingTests(`${result.stdout}${result.stderr}`);
      failures[device] = names.length ? names : ['*'];
      console.error(`\nFAILED on ${device}: ${failures[device].join(', ')}`);
    }
  }
  if (Object.keys(failures).length) {
    stopServer();
    console.log(`\nIOS_VERIFY_UI_FAILURES ${JSON.stringify(failures)}`);
    process.exit(1);
  }
}

stopServer();
console.log('\nios:verify passed.');
process.exit(0);
