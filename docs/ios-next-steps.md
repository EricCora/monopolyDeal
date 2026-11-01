# iOS app: decisions for later

Nothing here is built. These are the larger steps that need your call, with my recommendation for each.

| Step | Recommendation | Why |
|---|---|---|
| TestFlight | **Do first, if friends will play** | It's the easy way to get the app onto someone else's phone. It needs a paid Apple Developer account ($99 a year), and external testers go through a short Apple review. If you're the only one on iOS, Xcode installs are enough. |
| Universal links | **Do with TestFlight** | Invite links would open the app or the website, whichever the person has. It needs the paid account, a small file on the web host, and your site's address, which isn't in the repo yet. |
| Push notifications ("it's your turn") | **Later, only if online games drag** | It's the most useful upgrade for slow games between friends, but also the largest: Apple notification setup, plus new server work to store device tokens and send pushes. The free Render tier sleeps, so timing would be unreliable without a paid plan. |
| iCloud sync | **Skip for now** | It would only carry saves and stats between your own devices. A conflict between two devices would be easy to get wrong, for little benefit with one phone. |
| Game Center | **Skip** | Achievements and leaderboards aren't worth a second invite system alongside room codes. It also needs App Store setup, and the Monopoly name makes a public listing doubtful. |
