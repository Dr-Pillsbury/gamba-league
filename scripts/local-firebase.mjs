import { createRequire } from 'node:module';
const require = createRequire(
  new URL('../functions/package.json', import.meta.url),
);
export const projectId = 'demo-gamba-league';
// Never accept a production project or remote host from the environment.
for (const [name, expected] of Object.entries({
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
})) {
  if (
    process.env[name] &&
    ![
      '127.0.0.1:' + expected.split(':')[1],
      'localhost:' + expected.split(':')[1],
    ].includes(process.env[name])
  )
    throw Error('Local scripts only support loopback emulators.');
  process.env[name] = expected;
}
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const app =
  getApps().find((a) => a.name === 'local-tests') ??
  initializeApp({ projectId }, 'local-tests');
export const db = getFirestore(app);
export async function googleUser(name) {
  const jwt =
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url') +
    '.' +
    Buffer.from(
      JSON.stringify({
        sub: name,
        email: name + '@example.test',
        email_verified: true,
        name,
        iss: 'https://accounts.google.com',
        aud: projectId,
      }),
    ).toString('base64url') +
    '.';
  const response = await fetch(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo-key',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestUri: 'http://localhost',
        postBody: new URLSearchParams({
          id_token: jwt,
          providerId: 'google.com',
        }).toString(),
        returnSecureToken: true,
      }),
    },
  );
  const body = await response.json();
  if (!response.ok) throw Error(JSON.stringify(body));
  return {
    uid: body.localId,
    token: body.idToken,
    email: name + '@example.test',
  };
}
export async function callable(name, user, data) {
  const response = await fetch(
    `http://127.0.0.1:5001/${projectId}/us-central1/${name}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(user ? { Authorization: 'Bearer ' + user.token } : {}),
      },
      body: JSON.stringify({ data }),
    },
  );
  const body = await response.json();
  if (body.error) throw Error(body.error.status + ': ' + body.error.message);
  if (!response.ok) throw Error('Callable HTTP ' + response.status);
  return body.result;
}
export function seasonStart(now = Date.now()) {
  const easternDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const day = new Date(easternDay + 'T00:00:00Z');
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 5) % 7));
  return day.toISOString().slice(0, 10);
}
