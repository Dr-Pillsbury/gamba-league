# Gamba League

A single-season football picks league. Google authentication and Cloud Firestore hold shared league data; Firebase callable functions are the only writers for balances, bets, usernames, and result history. The React/Vinext frontend can be hosted on Sites.

## Current setup

Firebase web app: `gamba-league`. Season starts **Wednesday, September 9, 2026**, with 18 weekly periods. The web configuration is public identification, not an administrative credential. Analytics is not enabled.

Google Authentication and Firestore are enabled. hood.travis98@gmail.com has verified commissioner access. Sign-in domains and the season document are configured. Cloud Functions remain **undeployed**, as requested. The frontend disables account mutations and betting until config/league.backendEnabled is explicitly enabled after backend validation.

## nflverse data

The app now uses free public nflverse CSV files without an API key. The API-SPORTS key has been removed from the local environment and the old API client has been removed. Removing the local key does not revoke it at the provider.

The 2026 schedule and active rosters were downloaded and checked directly. The adapter matches games by nflverse game_id and players by GSIS ID. It supports passing/rushing/receiving yards and touchdowns, interceptions thrown, receptions, solo tackles and sacks. Total tackles remains commissioner-reviewed until assisted-tackle field semantics are verified. Missing values are never treated as zero. FanDuel Connecticut is the league default; sportsbook and grading-rule entry fields are removed. Freeform/parlay bets and special FanDuel conditions remain commissioner-reviewed.

Scheduled settlement is prepared for 10 a.m. America/New_York daily. It only considers games on a prior Eastern calendar day, at least eight hours after kickoff, with both scores present. Player props additionally require an explicit game/player statistic. Unpublished stats stay pending and retry on subsequent daily runs. Roster imports are cached for 24 hours. Commissioner overrides are preserved. Later provider corrections do not silently change already settled bets; use commissioner correction with a reason.

The owner can refresh schedules and rosters without deploying Cloud Functions:

    node scripts/sync-nfl.cjs hood.travis98@gmail.com

## Backend activation (deferred)

Cloud Functions remain undeployed on the owner's request. The frontend shows imported data, but betting and scheduled settlement remain disabled. Review Firebase costs before choosing Blaze. After approval, install root/functions dependencies, deploy the backend with the owner account, and test callable functions. No sports API secret is needed. Enable config/league.dataSyncEnabled, autoSettlementEnabled and backendEnabled only after verification.

## League accounting

- All money is stored as integer cents. Initial balance: 18000; weekly minimum: 1000.
- Immediate stake debit. Positive American odds profit = stake × odds / 100; negative odds profit = stake × 100 / absolute odds. Profit rounds to cents. Wins return stake + profit; pushes and voids refund stake; losses return zero.
- Reserve = 1000 × remaining weeks. Available amount = max(0, current balance − reserve). Week 1 starts at $10; settled returns immediately become spendable within the same week while the future-week reserve stays protected.
- Pending potential payouts cannot be spent. Commissioner corrections may create a reserve shortfall; new betting freezes until funds recover.
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
- [nflverse data and attribution](https://github.com/nflverse/nflverse-data)
- [nflverse update schedule](https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html)


## Setup helper

Run node scripts/setup-firebase.cjs hood.travis98@gmail.com to verify commissioner membership, fill an empty commissioner list and add sign-in domains without resetting league data. Firestore rules deny direct client writes to balances, bets and imported football data.

Framework updates removed the starter's high-severity advisories. Remaining moderate advisories are in upstream Firebase/CLI dependencies.

## FanDuel Connecticut and player reviews

New bets pin the July 30, 2026 Connecticut house-rules reference. Ordinary full-game pushes refund the stake. Player stats must also show participation evidence before automatic grading; absent evidence stays pending instead of being treated as a zero-stat loss/win or automatic void. Injury protection eligibility, promotional credits, suspended games and parlay recalculation are not automatically inferred from nflverse. The commissioner verifies those cases against FanDuel's applicable terms; no blanket injury-refund or paid Bet Protect+ enrollment is assumed.

Players can flag their own posted wins/losses with a 3–500 character reason. The flag is transactional, prevents duplicate requests for an already reviewed result, writes audit history and never changes balances. The commissioner queue permits confirming the same result or correcting it; either resolves the request with a reason and records the payout difference. Callable flagBet and settlement changes remain undeployed until backend activation is authorized.

Reference: https://d38ayms4az88sz.cloudfront.net/SB/CT/2026-07-30T12-42-48.html
