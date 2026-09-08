# Gamba League

A single-season football picks league. Google authentication and Cloud Firestore hold shared league data; Firebase callable functions are the only writers for balances, bets, usernames, and result history. The React/Vinext frontend can be hosted on Sites.

## Current setup

Firebase web app: `gamba-league`. Season starts **Wednesday, September 9, 2026**, with 18 weekly periods. The web configuration is public identification, not an administrative credential. Analytics is not enabled.

Google Authentication and Firestore are enabled. hood.travis98@gmail.com has verified commissioner access. Sign-in domains and the season document are configured. Cloud Functions remain **undeployed**, as requested. The frontend disables account mutations and betting until config/league.backendEnabled is explicitly enabled after backend validation.

## API-NFL: current access limitation

The secret is stored only in ignored .env.local as API_SPORTS_KEY. Never commit it or expose it in frontend code. API-NFL is the American-football product; API-Football is soccer.

On September 8, 2026, live verification confirmed an active Free account with 100 requests/day. The provider explicitly rejects season 2026 and permits only 2022–2024 on this account. No current games or rosters were imported. No billing or paid plan was activated. One permitted historical game was read to verify data shape and stat labels; it was not imported into the league.

Prepared features include schedules, rosters, position-based props, manually entered sportsbook odds, grading notes and commissioner corrections. Final full-game scores and explicit supported player stats can grade structured bets. Missing stats remain pending. Parlays, freeform selections, custom sportsbook rules and ambiguous total-tackle fields require commissioner review. Choose custom grading for participation, shortened-game or cancellation policies that differ from the app's full-game rules.

The importer caches rosters for seven days, caps runs at 20 requests, spaces calls to respect 10/minute, and stops at 90 daily requests. Other uses of the key share its provider quota. No automatic import or settlement runs while Cloud Functions are undeployed.

Once current-season access is available, run this local schedule/roster import:

    node scripts/sync-nfl.cjs hood.travis98@gmail.com

## Backend activation (deferred)

The project uses Spark. Review costs and explicitly decide on Blaze before deployment. Future steps, not executed in this session:

1. Install dependencies in the root and functions folders using npm ci.
2. Set the API_SPORTS_KEY Firebase Functions secret using the owner account.
3. Deploy Firestore and functions with the project-local Firebase CLI and --account hood.travis98@gmail.com.
4. Verify current-season coverage and grading, then enable config/league.dataSyncEnabled and autoSettlementEnabled. The score job runs every six hours.
5. Test callable functions and set backendEnabled to true before inviting players.

Commissioner corrections require a reason and adjust only the payout difference. Automatic jobs never overwrite them. Do not change the season start after entries exist.

## League accounting

- All money is stored as integer cents. Initial balance: 18000; weekly minimum: 1000.
- Immediate stake debit. Positive American odds profit = stake × odds / 100; negative odds profit = stake × 100 / absolute odds. Profit rounds to cents. Wins return stake + profit; pushes and voids refund stake; losses return zero.
- Reserve = 1000 × remaining weeks. Available amount = max(0, min(current balance − reserve, Wednesday opening balance − reserve − weekly stake)). This keeps Week 1’s total at $10 even if an early bet wins.
- Cashflow at or after Wednesday midnight cannot inflate that week’s opening allowance. Pending potential payouts cannot be spent. Commissioner's downward corrections can create a reserve shortfall; new betting freezes until funds recover.
- The weekly minimum may be split into smaller bets. Pushes count; voids do not. A void restores weekly stake capacity within the current cash limit. Missed minimums are flagged without an automatic penalty.
- Bet submissions use server time, are immutable, and require an upcoming start inside the current week. Custom events rely on the supplied start time and commissioner review. For a parlay, use the earliest leg start.
- Transactions serialize concurrent bets against the player's wallet. A client request ID makes retries idempotent. Settlement is transactional and repeat-safe.
- Wednesday snapshots reconstruct balances and weekly compliance at the cutoff from the append-only ledger. Late results and corrections affect live standings, not frozen historical finishes. No automatic winner is declared while results remain pending; the top final live balance is the winner once all Week 18 bets are settled.
- Usernames are case-insensitively unique, 3–20 letters/numbers/underscores. Joining after Week 1 is disabled. This is one friends league and one season; a season reset or multiple leagues is not implemented.

## Development and validation

```powershell
node "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js" run dev
node --test tests/*.test.mjs
node node_modules/typescript/bin/tsc --noEmit
node "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js" run build
```

Tests cover payout rounding, protected funds, split bets, next-week rollover, Eastern/DST boundaries, invalid and late bets, score grading, and correction deltas. Build/type checks do not replace end-to-end Firebase validation. Before inviting friends, verify two Google accounts, username collision handling, a concurrent overspend attempt, a settled result, a repeated settlement, an automatic score sync if enabled, and a commissioner correction in the deployed Firebase project or emulators.

The optional WebMCP `view_league_bets` tool changes the same bet-feed tab and filter as the UI. It is feature-detected and registered with cleanup; no supported WebMCP validation context was available in this session.

## References

- [Firebase Google sign-in](https://firebase.google.com/docs/auth/web/google-signin)
- [Firebase callable functions](https://firebase.google.com/docs/functions/callable)
- [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions)
- [Firebase functions setup and deployment](https://firebase.google.com/docs/functions/get-started)
- [API-NFL](https://api-sports.io/sports/nfl)


## Setup helper

Run node scripts/setup-firebase.cjs hood.travis98@gmail.com to verify commissioner membership, fill an empty commissioner list and add sign-in domains without resetting league data. Firestore rules deny direct client writes to balances, bets and imported football data.

Framework updates removed the starter's high-severity advisories. Remaining moderate advisories are in upstream Firebase/CLI dependencies.
