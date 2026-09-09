import { initializeApp, getApps } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup,
} from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from 'firebase/functions';
// Local development is deliberately isolated from the live league.
export const isLocalDevelopment = process.env.NODE_ENV === 'development';
const config = {
  apiKey: 'AIzaSyDzANtawSdIGlZaZP1q9HAKs1lDnn42cRg',
  authDomain: 'gamba-league.firebaseapp.com',
  projectId: 'gamba-league',
  storageBucket: 'gamba-league.firebasestorage.app',
  messagingSenderId: '751417505273',
  appId: '1:751417505273:web:a688db7174c481501d7928',
};
const appName = isLocalDevelopment ? 'local-league' : '[DEFAULT]';
const existing = getApps().find((app) => app.name === appName);
const app =
  existing ??
  initializeApp(
    isLocalDevelopment
      ? {
          ...config,
          projectId: 'demo-gamba-league',
          apiKey: 'demo-key',
          authDomain: 'localhost',
        }
      : config,
    appName,
  );
export const auth = getAuth(app),
  db = getFirestore(app),
  functions = getFunctions(app, 'us-central1');
if (isLocalDevelopment && !existing) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}
export function loginLocal(name: 'commissioner' | 'player') {
  if (!isLocalDevelopment)
    throw Error('Demo sign-in is available only in local development.');
  // The Auth emulator accepts unsigned test identity tokens. Production Google
  // authentication never uses this branch.
  const encode = (value: object) =>
    btoa(JSON.stringify(value))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  const token =
    encode({ alg: 'none' }) +
    '.' +
    encode({
      sub: name,
      email: name + '@example.test',
      email_verified: true,
      name,
      iss: 'https://accounts.google.com',
      aud: 'demo-gamba-league',
    }) +
    '.';
  return signInWithCredential(auth, GoogleAuthProvider.credential(token));
}
export const login = () =>
  isLocalDevelopment
    ? loginLocal('commissioner')
    : signInWithPopup(auth, new GoogleAuthProvider());
export async function call(name: string, data: unknown = {}) {
  return (await httpsCallable(functions, name)(data)).data;
}
