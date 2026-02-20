# UX Improvements Backlog

This backlog is prioritized for practical, staged delivery.

| Priority | Problem | Impact | Proposed solution | Effort | Dependencies | Acceptance criteria |
|---|---|---|---|---|---|---|
| P1 | Selection flows still feel opaque in dense states | High | Keep valid target highlighting and add explicit target hint copy | S | `GameTableScreen` pending logic | Users can identify valid selection cards without trial clicks |
| P1 | Turn context can be lost in busy tables | High | Add persistent last-action summary panel | S | Event history data | Last action is visible without opening full log |
| P1 | Payment clarity still varies by branch | High | Add explicit remaining owed line and overpay delta emphasis | S | Payment panel data | Users can compute required payment at a glance |
| P1 | Host controls are visually dense | Medium | Group host controls into compact sections by task | M | Multiplayer table top bar | New hosts can locate checkpoint/flow controls in <=2 interactions |
| P2 | Illegal-action feedback is generic | Medium | Add richer inline reason text where safe to expose | M | Engine error code mapping | Error messages reduce repeat invalid attempts |
| P2 | Event feed competes with main action area on mobile | Medium | Add collapsible social/activity panel on narrow breakpoints | M | Responsive layout | Primary action controls remain unobstructed on mobile |
| P2 | First-time rules comprehension remains steep | Medium | Add optional guided prompt tutorial entry | M | Existing Rules drawer | New users complete first turn with fewer stalls |
| P3 | Stats readability on small screens | Medium | Add simplified metrics card mode | M | Stats dashboard component | Core metrics readable on <=390px width |
| P3 | Accessibility non-color redundancy gaps | Medium | Add shape/icon affordances for selection states | M | Theme component styles | Selection states remain distinguishable with color filters |
| P3 | Power-user efficiency | Low | Add keyboard shortcuts for common actions | L | Input focus handling | Frequent players can complete turns with reduced pointer use |

## Manual verification script (desktop + mobile)

1. Start local app and play one full 2-player match.
2. Trigger each pending flow: payment, counter, sly deal, forced deal, deal breaker.
3. Verify valid target highlighting and pending banners stay in sync.
4. Verify payment panel messaging for full pay, overpay, and shortfall.
5. Check multiplayer lobby/table at mobile width (~390px) and desktop width.
