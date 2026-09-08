// Verify deployed resources before enabling the existing league; never reset data.
const { selectAccount, setActiveAccount } = require('firebase-tools/lib/auth');
const { requireAuth } = require('firebase-tools/lib/requireAuth');
const { Client } = require('firebase-tools/lib/apiv2');
async function main() {
  const project = 'gamba-league', options = { project, nonInteractive: true };
  setActiveAccount(options, selectAccount('hood.travis98@gmail.com', process.cwd()));
  await requireAuth(options);
  const functions = new Client({ urlPrefix: 'https://cloudfunctions.googleapis.com', auth: true });
  const base = `/v2/projects/${project}/locations/us-central1/functions`;
  const callable = ['joinLeague', 'placeBet', 'settleBet', 'refreshStandings', 'flagBet', 'reviewJoinRequest'];
  for (const name of [...callable, 'closeLeagueWeeks', 'syncFootballScores']) {
    const f = (await functions.get(base + '/' + name)).body;
    if (f.state !== 'ACTIVE') throw Error(name + ' is not ACTIVE. League remains paused.');
    if (callable.includes(name)) {
      const r = await fetch(f.serviceConfig.uri, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: {} }) });
      const body = await r.json();
      if (r.status !== 401 || body.error?.status !== 'UNAUTHENTICATED') throw Error(name + ' failed the authentication smoke check.');
    }
    console.log(name + ': ACTIVE' + (callable.includes(name) ? ', authentication enforced' : ''));
  }
  const scheduler = new Client({ urlPrefix: 'https://cloudscheduler.googleapis.com', auth: true });
  const jobBase = `/v1/projects/${project}/locations/us-central1/jobs/`;
  for (const [name, schedule] of [['syncFootballScores', '0 10 * * *'], ['closeLeagueWeeks', '15 10 * * 2']]) {
    const job = (await scheduler.get(jobBase + `firebase-schedule-${name}-us-central1`)).body;
    if (job.state !== 'ENABLED' || job.schedule !== schedule || job.timeZone !== 'America/New_York') throw Error(name + ' schedule is not ready.');
    console.log(name + ': schedule verified, America/New_York');
  }
  const db = new Client({ urlPrefix: 'https://firestore.googleapis.com', auth: true });
  const path = `/v1/projects/${project}/databases/(default)/documents/config/league`;
  const before = (await db.get(path)).body;
  if (!['2026-09-08', '2026-09-09'].includes(before.fields?.startDate?.stringValue) || !before.fields?.commissionerUids?.arrayValue?.values?.length) throw Error('League configuration is incomplete.');
  if (process.argv.includes('--verify-only')) {
    console.log('Verification complete. No settings changed or jobs triggered.');
    return;
  }
  const names = ['backendEnabled', 'dataSyncEnabled', 'autoSettlementEnabled'];
  await db.patch(path, { fields: { ...Object.fromEntries(names.map(n => [n, { booleanValue: true }])), startDate: {stringValue:'2026-09-08'} } }, {
    queryParams: { 'updateMask.fieldPaths': [...names, 'startDate'], 'currentDocument.updateTime': before.updateTime },
  });
  const after = (await db.get(path)).body;
  if (!names.every(n => after.fields?.[n]?.booleanValue === true)) throw Error('Activation verification failed.');
  console.log('Verified: betting, data imports and automatic settlement enabled.');
  await scheduler.post(jobBase + 'firebase-schedule-syncFootballScores-us-central1:run', {});
  console.log('Requested the first scheduled nflverse refresh.');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
