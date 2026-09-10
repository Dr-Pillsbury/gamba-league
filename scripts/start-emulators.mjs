import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const work = path.join(root, 'work');
mkdirSync(work, { recursive: true });
const javaRoot = path.join(work, 'java');
const portable = existsSync(javaRoot)
  ? readdirSync(javaRoot)
      .map((name) => path.join(javaRoot, name))
      .find((dir) =>
        existsSync(
          path.join(
            dir,
            'bin',
            process.platform === 'win32' ? 'java.exe' : 'java',
          ),
        ),
      )
  : null;
const env = {
  ...process.env,
  XDG_CONFIG_HOME: path.join(work, 'config'),
  FIREBASE_EMULATORS_PATH: path.join(work, 'emulators'),
};
// Windows treats Path/PATH as the same key, but Node's child-process
// environment can retain both and select the wrong value. Emit one PATH.
const inheritedPath = process.env.PATH ?? process.env.Path ?? '';
for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
env.PATH = [path.dirname(process.execPath), ...(portable ? [path.join(portable, 'bin')] : []), inheritedPath].join(path.delimiter);
env.METADATA_SERVER_DETECTION = 'none';
env.FUNCTIONS_DISCOVERY_TIMEOUT ??= '60';
if (portable) env.JAVA_HOME = portable;
const child = spawn(
  process.execPath,
  [
    'node_modules/firebase-tools/lib/bin/firebase.js',
    'emulators:start',
    '--only',
    'auth,firestore,functions',
    '--project',
    'demo-gamba-league',
  ],
  { cwd: root, env, stdio: 'inherit', windowsHide: true },
);
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
