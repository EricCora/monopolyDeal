/**
 * The iOS app's verification command: `npm run ios:verify`
 *
 *  1. Swift package tests: conformance with the TypeScript engine, 4,000 fuzzed games,
 *     saves, stats, bots, and full online matches against a real room server.
 *  2. The app builds for the simulator.
 *  3. UI tests play games through the screen on iPhone and iPad.
 *
 * `--skip-ui` leaves out step 3. Build output stays out of the repo, because this folder
 * may sync to iCloud.
 */
import { spawn, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const ios = join(root, 'apps/ios');
const cache = join(homedir(), 'Library/Caches/MonopolyDealBuild');
const port = 8799;
const serverUrl = `http://localhost:${port}`;
const skipUi = process.argv.includes('--skip-ui');
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

step('Swift package tests');
run('swift', ['test', '-c', 'release', '-Xswiftc', '-enable-testing', '--scratch-path', join(cache, 'dealkit-release')], {
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
  for (const device of ['iPhone 18 Pro Max', 'iPad Pro 13-inch (M5)']) {
    console.log(`\n--- ${device}`);
    run('xcodebuild', ['-project', 'MonopolyDeal.xcodeproj', '-scheme', 'MonopolyDeal', '-destination', `id=${simulatorId(device)}`, '-derivedDataPath', join(cache, 'dd'), 'test', '-quiet'], {
      cwd: ios,
      env: { ...process.env, TEST_RUNNER_DEAL_TEST_SERVER_URL: serverUrl },
    });
  }
}

stopServer();
console.log('\nios:verify passed.');
process.exit(0);
