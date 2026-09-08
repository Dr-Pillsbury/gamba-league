import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
const config = {
  apiKey: 'AIzaSyDzANtawSdIGlZaZP1q9HAKs1lDnn42cRg',
  authDomain: 'gamba-league.firebaseapp.com',
  projectId: 'gamba-league',
  storageBucket: 'gamba-league.firebasestorage.app',
  messagingSenderId: '751417505273',
  appId: '1:751417505273:web:a688db7174c481501d7928',
};
const app = getApps()[0] ?? initializeApp(config);
export const auth = getAuth(app),
  db = getFirestore(app),
  functions = getFunctions(app, 'us-central1');
export const login = () => signInWithPopup(auth, new GoogleAuthProvider());
export async function call(name: string, data: unknown = {}) {
  return (await httpsCallable(functions, name)(data)).data;
}
