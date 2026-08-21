/**
 * Seed the local Firebase emulators with one account per role, plus a small
 * item catalog, so the app can be exercised end-to-end without touching the
 * real project.
 *
 * DEV ONLY. It refuses to run unless the emulator environment variables are
 * set, so these throwaway passwords can never reach production.
 *
 *   npm run emulators        # terminal 1
 *   npm run seed             # terminal 2
 */
import { initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';

const PROJECT_ID = process.env.SEED_PROJECT_ID || 'neom-order-purchase';
const LOGIN_DOMAIN = process.env.SEED_LOGIN_DOMAIN || 'neommodular.com';
const AUTH_HOST = '127.0.0.1:9099';
const FIRESTORE_HOST = '127.0.0.1:8080';

// Refuse to run against anything but a local emulator.
process.env.FIRESTORE_EMULATOR_HOST ??= FIRESTORE_HOST;
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= AUTH_HOST;
for (const [name, value] of [
  ['FIRESTORE_EMULATOR_HOST', process.env.FIRESTORE_EMULATOR_HOST],
  ['FIREBASE_AUTH_EMULATOR_HOST', process.env.FIREBASE_AUTH_EMULATOR_HOST],
]) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(value ?? '')) {
    console.error(`Refusing to seed: ${name} is "${value}", which is not a local emulator.`);
    process.exit(1);
  }
}

const ACCOUNTS = [
  { loginId: 'admin', password: 'admin123', name: 'System Admin', role: 'admin' },
  { loginId: 'operator', password: 'oper123', name: 'Ravi Operator', role: 'operator' },
  { loginId: 'purchase', password: 'pur123', name: 'Ananya Purchase', role: 'purchase_manager' },
  { loginId: 'inward', password: 'inw123', name: 'Imran Inward', role: 'inward_manager' },
];

const CATALOG = [
  { name: 'Structural angle bar 2in', unit: 'pcs', defaultPrice: 480 },
  { name: 'M12 hex bolt', unit: 'pcs', defaultPrice: 14.5 },
  { name: 'Rockwool insulation slab', unit: 'box', defaultPrice: 2650 },
  { name: 'Galvanised sheet 1.2mm', unit: 'kg', defaultPrice: 96 },
];

const app = initializeApp({ apiKey: 'demo-key', projectId: PROJECT_ID, appId: 'demo-app' }, 'seed');
const auth = getAuth(app);
connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });

/** Create the credential if it does not exist; return its uid either way. */
async function ensureAccount({ loginId, password }) {
  const email = `${loginId}@${LOGIN_DOMAIN}`;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    return cred.user.uid;
  } catch (e) {
    if (e?.code !== 'auth/email-already-in-use') throw e;
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return cred.user.uid;
  }
}

const uids = [];
for (const account of ACCOUNTS) {
  uids.push({ ...account, uid: await ensureAccount(account) });
}

// Profiles carry roles, which the security rules read — so they must be
// written with rules bypassed, exactly as the real bootstrap does by hand
// in the Firebase console.
const env = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { rules: readFileSync('firestore.rules', 'utf8') },
});

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (const { uid, loginId, name, role } of uids) {
    await setDoc(doc(db, 'users', uid), {
      name,
      loginId,
      email: `${loginId}@${LOGIN_DOMAIN}`,
      role,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  for (const [i, item] of CATALOG.entries()) {
    await setDoc(doc(db, 'itemCatalog', `seed-${i}`), {
      ...item,
      nameLower: item.name.toLowerCase(),
      active: true,
      createdAt: serverTimestamp(),
      createdBy: { uid: uids[0].uid, name: uids[0].name },
    });
  }
});

await env.cleanup();

console.log(`\nSeeded ${PROJECT_ID} emulators.\n`);
console.log('  Login ID   Password   Role');
console.log('  ---------  ---------  -----------------');
for (const a of ACCOUNTS) {
  console.log(`  ${a.loginId.padEnd(9)}  ${a.password.padEnd(9)}  ${a.role}`);
}
console.log(`\n  ${CATALOG.length} catalog items added.`);
console.log('\nSet VITE_USE_EMULATORS=true in .env.local, then: npm run dev\n');
process.exit(0);
