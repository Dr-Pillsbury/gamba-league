// Owner-run cached schedule/roster import. No server deployment or bet settlement.
const { selectAccount, setActiveAccount } = require('firebase-tools/lib/auth');
const { requireAuth } = require('firebase-tools/lib/requireAuth');
const { Client } = require('firebase-tools/lib/apiv2');
const project = 'gamba-league';
function encode(value) {
  if (value === null) return { nullValue: null };
  if (Array.isArray(value))
    return { arrayValue: { values: value.map(encode) } };
  if (typeof value === 'object')
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value).map(([k, v]) => [k, encode(v)]),
        ),
      },
    };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number')
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  return { stringValue: String(value) };
}
function decode(value) {
  if ('nullValue' in value) return null;
  if (value.arrayValue) return (value.arrayValue.values ?? []).map(decode);
  if (value.mapValue)
    return Object.fromEntries(
      Object.entries(value.mapValue.fields ?? {}).map(([k, v]) => [
        k,
        decode(v),
      ]),
    );
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  return value.stringValue;
}
async function main() {
  const email = process.argv[2] ?? 'hood.travis98@gmail.com';
  const options = { project, nonInteractive: true };
  setActiveAccount(options, selectAccount(email, process.cwd()));
  await requireAuth(options);
  const client = new Client({
    urlPrefix: 'https://firestore.googleapis.com',
    auth: true,
  });
  const base = '/v1/projects/' + project + '/databases/(default)/documents/';
  const read = async (path) => {
    try {
      return (await client.get(base + path)).body;
    } catch (e) {
      if (
        e.status === 404 ||
        e.context?.response?.statusCode === 404 ||
        String(e.message).includes('404')
      )
        return null;
      throw e;
    }
  };
  const data = (doc) =>
    doc ? decode({ mapValue: { fields: doc.fields } }) : null;
  const store = {
    get: async (path) => data(await read(path)),
    set: async (path, value) => {
      await client.patch(base + path, {
        fields: encode(value).mapValue.fields,
      });
    },
    update: async (path, fn) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const previous = await read(path),
          next = fn(data(previous));
        try {
          await client.patch(
            base + path,
            { fields: encode(next).mapValue.fields },
            {
              queryParams: previous
                ? { 'currentDocument.updateTime': previous.updateTime }
                : { 'currentDocument.exists': false },
            },
          );
          return;
        } catch (e) {
          if (![409, 412].includes(e.status) || attempt === 4) throw e;
        }
      }
    },
  };
  const config = await store.get('config/league');
  if (!config?.startDate) throw Error('Configure the league season first.');
  const { runNflImport } = await import('../functions/nfl-sync.js');
  const result = await runNflImport({
    store,
    season: Number(config.startDate.slice(0, 4)),
  });
  console.log(JSON.stringify(result));
  console.log(
    'Schedule and available rosters imported. Cloud Functions remain undeployed.',
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
