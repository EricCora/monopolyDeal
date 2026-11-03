# Monopoly Deal for iOS

A native SwiftUI app with the same local and online features as the web app, plus nearby play between iPhones with no internet. Needs Xcode 27 and iOS 27 or later.

## Run it on your iPhone

1. Open `apps/ios/MonopolyDeal.xcodeproj` in Xcode.
2. Select your iPhone as the destination and press Run. The first time, Xcode may ask you to turn on Developer Mode on the phone or trust your developer certificate.

Your signing team is already set in the project. To use a different one, change it under **Signing & Capabilities** for the MonopolyDeal target. With a free Apple ID, the install expires after 7 days; run it from Xcode again to renew it.

## Check it on a real device

Automated tests can't cover touch and feel, so try these on the phone:

- [ ] **Motion:** cards glide smoothly from hand to table, with no stutter while a bot is playing.
- [ ] **Hand:** tapping, and dragging a card upward to play it, both feel right. Holding spreads the hand, and sliding along it lifts each card so you can read it.
- [ ] **Haptics and sound:** they fire when you play a card, and the toggles in Settings turn them off.
- [ ] **Hard bot:** the table stays responsive while it thinks, and each move takes no more than a few seconds.
- [ ] **Pass-and-play:** the next player's hand stays hidden until they tap Show My Hand.
- [ ] **Interrupted game:** force-quit mid-game. Continue Game brings it back.
- [ ] **Online with a friend or a browser:** host a room, share the invite, finish a match, and tap Rematch.
- [ ] **Dropped connection:** switch to Airplane Mode for a minute mid-match, then back. The app rejoins your seat.
- [ ] **Invite link:** open `monopolydeal://join/CODE` from Messages. The code is filled in.
- [ ] **Nearby, no internet:** with both phones in Airplane Mode but Bluetooth and Wi-Fi turned back on, one taps Play Nearby and Host a Table, the other joins it. Allow the Local Network prompt on each phone the first time. Finish a game and tap Rematch.
- [ ] **Nearby drop:** lock the joining phone mid-game for a minute. The host pauses with the player shown as away. Unlock it: it rejoins its seat by itself. Then try Let a Bot Play on the host while the other phone is locked.
- [ ] **Nearby host closed:** force-quit the host mid-game. Reopen it, open Nearby and tap Continue. The other phone rejoins.
- [ ] **Nearby range:** walk apart until the link drops, then come back. Note roughly how far it reached.
- [ ] **Share:** the results screen's Share button produces a good-looking image.
- [ ] **VoiceOver:** with VoiceOver on, play a turn. Automated checks cover labels but not how a real game sounds.

## Layout

- `DealKit/`: Swift package with no UI, tested by `swift test`.
  - `DealEngine`: the rules, a port of `src/engine`.
  - `DealAI`: the easy and hard bots and the coach, a port of `src/ai`.
  - `DealStats`: saves, stats, achievements and the post-game recap.
  - `DealOnline`: the room client, using HTTP and SSE. Six-letter room codes are turn-by-turn rooms, which poll the website instead.
  - `DealNearby`: nearby play with no internet. `NearbyTable` is the host's table, masked and rule-checked like a room on the server. `NearbyHost` and `NearbyGuest` exchange its messages over Multipeer Connectivity, or over an in-memory link in the tests.
- `App/`: the SwiftUI screens.
- `AppUITests/`: tests that play games through the screen. `PlaytestRoundTests` walks the bank, log, history, replay and room screens, and attaches screenshots to the result bundle.

## Installing on the iPhone from the command line

Xcode isn't needed once the phone is paired. Use the device id from `xcrun devicectl list devices`:

```bash
xcodebuild -project MonopolyDeal.xcodeproj -scheme MonopolyDeal -configuration Release -destination generic/platform=iOS -derivedDataPath ~/Library/Caches/MonopolyDealBuild/device -allowProvisioningUpdates build
```

```bash
xcrun devicectl device install app --device <id> ~/Library/Caches/MonopolyDealBuild/device/Build/Products/Release-iphoneos/MonopolyDeal.app
```

## Changing the rules

The TypeScript engine is the source of truth.

1. Change `src/engine/` and its tests.
2. Run `npm run traces:record` to re-record the games the Swift engine must match.
3. Port the change to `DealKit/Sources/DealEngine`, until `npm run ios:verify` passes.

If a recorded game diverges, compare the two engines step by step:

```bash
npm run traces:record -- --dump 417 /tmp/ts.txt
```

```bash
cd apps/ios/DealKit && DEAL_DUMP_GAME=417 DEAL_DUMP_PATH=/tmp/swift.txt swift test --filter EngineConformanceTests
```

```bash
diff /tmp/ts.txt /tmp/swift.txt
```

## Debug launch arguments

Add these under **Product > Scheme > Edit Scheme > Run > Arguments**:

| Argument | Effect |
| --- | --- |
| `-serverURL http://localhost:8787` | Uses a local room server instead of the hosted one |
| `-seed 11` | Deals the same cards every time |
| `-botDelayMs 60` | Shortens the bot's pause |
| `-speedTurnSeconds 2` | Shortens a Speed turn, so bots finish a game unattended |
| `-winSets 1` | Sets the number of complete sets needed to win |
| `-route online` | Opens on a screen: `setup`, `saved`, `stats`, `settings`, `online` or `nearby` |
| `-storeDirectory NAME` | Uses a throwaway save folder |
| `-autoplayGames 3 -autoplayVariant no_mercy -autoplayPlayers 4` | Plays whole games by itself (Debug builds only) |
| `-autoplayOnlineRoom CODE` | Joins a room and plays its seat by itself (Debug builds only) |
| `-autoplayNearby host` or `-autoplayNearby join` | Hosts a nearby table and deals once someone joins, or joins the first table found. Each phone plays its own seat and logs `NEARBY-AUTOPLAY` lines, also written to `Documents/nearby-autoplay.txt` (Debug builds only) |
