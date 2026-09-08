# Gamba League

A single-season football picks league. Google authentication and Cloud Firestore hold shared league data; Firebase callable functions are the only writers for balances, bets, usernames, and result history. The React/Vinext frontend can be hosted on Sites.

## Current setup

Firebase web app: `gamba-league`. Season starts **Wednesday, September 9, 2026**, with 18 weekly periods. The web configuration is public identification, not an administrative credential. Analytics is not enabled.

Google Authentication and the production-mode Firestore database have been enabled by the project owner. Server deployment and commissioner configuration still need the steps below. No real balances or wagers should be entered until that setup is complete.

## Firebase console steps

1. Authentication → Settings → Authorized domains: add `localhost` and `gamba-league.doc-pillsbury.chatgpt.site`. Enter hostnames without `https://` or a path.
2. Sign into the app once with Google. Authentication → Users will then show your **User UID**; copy it.
3. Firestore Database → Data → Start collection: collection ID `config`, document ID `league`. Add these fields with the exact types:

   | Field | Type | Value |
   | --- | --- | --- |
   | `startDate` | string | `2026-09-09` |
   | `commissionerUids` | array | one string: your Firebase User UID |
   | `autoSettlementEnabled` | boolean | `false` initially |

   Configure this using the Firebase console as project owner. Clients cannot grant themselves commissioner access. Do not change the start date once the league has entries. All Google users who can reach the site may join before the end of Week 1; site sharing controls determine the audience.
4. Deploy Firestore rules and the server functions below. Do not switch Firestore to test mode. The supplied rules permit league reads and deny all direct client writes.
5. Cloud Functions deployment requires the Firebase **Blaze** plan. Enable billing yourself in the console if needed; set a budget alert. The app does not enable billing for you.

## Deploy the backend from this project

Dependencies have been installed. PowerShell commands below use the local Firebase CLI and avoid this computer’s broken global npm shim:

```powershell
.\scripts\firebase.ps1 login
.\scripts\firebase.ps1 deploy --project gamba-league --only "firestore,functions:joinLeague,functions:placeBet,functions:settleBet,functions:closeLeagueWeeks,functions:refreshStandings"
```

Sign in through Google's browser page. Do not send service-account private keys, tokens, or passwords in chat. If deploying from a fresh checkout, run `npm ci` in the root and in `functions` first. The cloud runtime uses Node.js 22; local development also works on Node.js 24.

## Automatic score settlement (optional activation)

The app accepts custom selections, props, parlays and other sportsbook markets. These are reviewed by the commissioner because freeform descriptions cannot safely be graded from a final game score.

For automatic full-game NFL moneylines, spreads, and totals:

1. Obtain a **The Odds API** key with access to its NFL scores endpoint. Keep it server-side.
2. Set the secret interactively:

   ```powershell
   .\scripts\firebase.ps1 functions:secrets:set ODDS_API_KEY --project gamba-league
   .\scripts\firebase.ps1 deploy --project gamba-league --only functions:syncFootballScores
   ```

3. Set `config/league.autoSettlementEnabled` to `true`. The schedule runs every six hours and requests the last three days of completed games. It also imports upcoming events into the game picker. A new deployment does not immediately run the schedule; use Google Cloud Scheduler's **Run now** if an immediate first sync is needed.
4. Choose an imported game and a structured market in the app. Scores are matched by provider event ID, not guessed from free text. Only final, complete scores can settle a bet. Full-game bets include overtime; two-way moneyline ties push. Other sportsbook rules, partial periods, canceled or suspended games, unmatched events, props, and parlays require commissioner review. A prolonged feed outage may exceed the provider’s three-day lookback; review remaining pending bets manually.
5. Commissioner corrections include a reason, are written to audit history, and adjust only the difference between old and new payouts. Automatic jobs never overwrite a commissioner result.

A player-stat provider and structured prop/leg mapping are needed to extend automatic settlement to player props and parlays. The current version does not claim to verify arbitrary freeform bets automatically.

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
node --test tests/rules.test.mjs
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
- [The Odds API scores documentation](https://the-odds-api.com/liveapi/guides/v4/#get-scores)


## Setup progress in this session

The season document and Google sign-in domains have now been configured through the project owner's authenticated Firebase CLI account. The commissioner UID is pending the owner's first Google sign-in at the website. After that sign-in, run `node scripts/setup-firebase.cjs hood.travis98@gmail.com` to fill an empty commissioner list without resetting existing league data.

The initial server deployment was blocked by the project's Spark plan. Blaze must be enabled by the owner before deploying Cloud Functions. Use `--account hood.travis98@gmail.com` with the deployment commands if another Firebase CLI login is the global default.

Compatible framework security updates removed the high-severity advisories reported by the starter. Remaining moderate advisories are in upstream Firebase/CLI dependency chains; forced major-version downgrades were not applied. Review those advisories before broader production use.
