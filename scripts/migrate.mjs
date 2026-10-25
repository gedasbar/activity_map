// Prepares the database for the strict security rules (firestore.rules).
//
// What it does (and nothing else):
//   1. Creates the missing couples/{coupleId} document for every couple, listing the users whose profile points
//      at it (older couples have none yet). If one exists, missing members are added.
//   2. Fills in missing `uid` / `email` on user profiles from the sign-in account.
//
// What it never does: it does not move, rename, rewrite or delete any city, place, memory or photo, and it never
// deletes or overwrites a field that already has a value. The couple ids stay exactly as they are.
//
// Dry run by default: it prints the plan and writes nothing. Add --apply to write. Before writing it saves the
// previous state of every document it will change to backups/migration-<time>/before.json.
//
//   node migrate.mjs                     dry run
//   node migrate.mjs --apply             do it
//   node migrate.mjs --key other.json    use a different key file
//   node migrate.mjs --allow-orphans     proceed even if some data belongs to no known couple
//   node migrate.mjs --emulator          run against the local emulators (used by the tests)

import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_PROJECT_ID = 'activity-map-155d8';
const EMULATOR_PROJECT_ID = 'demo-activity-map';
const DATA_COLLECTIONS = ['unlocked_cities', 'saved_places', 'visited_logs'];
const MAX_MEMBERS = 2;

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const apply = flag('--apply');
const allowOrphans = flag('--allow-orphans');
const useEmulator = flag('--emulator');

const fail = (message) => {
  console.error(`\nError: ${message}\n`);
  process.exit(1);
};

process.on('uncaughtException', (e) => {
  const text = String(e?.message ?? e);
  if (/UNAUTHENTICATED|invalid_grant|Invalid JWT/i.test(text)) fail('Google rejected the key. Generate a fresh one (scripts/README.md, step 1).');
  if (/PERMISSION_DENIED|403/.test(text)) fail('The key was accepted but is not allowed to access this project.');
  fail(text);
});

// ---------- connect ----------

if (useEmulator) {
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8085';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
  process.env.METADATA_SERVER_DETECTION ??= 'none'; // skip probing for a Google cloud metadata server
  initializeApp({ projectId: EMULATOR_PROJECT_ID });
  console.log('Using the local emulators (nothing real is touched).\n');
} else {
  const keyPath = path.resolve(option('--key', path.join(here, 'serviceAccountKey.json')));
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(await readFile(keyPath, 'utf8'));
  } catch {
    fail(`Could not read the service account key at:\n  ${keyPath}\nSee scripts/README.md, step 1.`);
  }
  if (serviceAccount.project_id !== EXPECTED_PROJECT_ID) {
    fail(`This key is for project "${serviceAccount.project_id}", but this app uses "${EXPECTED_PROJECT_ID}". Nothing was read.`);
  }
  initializeApp({ credential: cert(serviceAccount) });
  console.log(`Project ${EXPECTED_PROJECT_ID}\n`);
}

const db = getFirestore();

// ---------- read everything that matters ----------

const readAll = async (name) => (await db.collection(name).get()).docs.map((d) => ({ id: d.id, ref: d.ref, data: d.data() }));

const [users, couples] = await Promise.all([readAll('users'), readAll('couples')]);
const dataCoupleIds = new Map(); // coupleId -> { unlocked_cities: n, ... }
for (const name of DATA_COLLECTIONS) {
  for (const d of await readAll(name)) {
    const id = d.data.coupleId;
    const counts = dataCoupleIds.get(id) ?? {};
    counts[name] = (counts[name] ?? 0) + 1;
    dataCoupleIds.set(id, counts);
  }
}

const authUsers = new Map();
let pageToken;
do {
  const page = await getAuth().listUsers(1000, pageToken);
  for (const u of page.users) authUsers.set(u.uid, { email: u.email ?? null });
  pageToken = page.pageToken;
} while (pageToken);

console.log(`Found ${users.length} user profiles, ${authUsers.size} sign-in accounts, ${couples.length} couples documents.`);
console.log(`Data: ${DATA_COLLECTIONS.map((n) => `${n}=${[...dataCoupleIds.values()].reduce((s, c) => s + (c[n] ?? 0), 0)}`).join(', ')}\n`);

// ---------- plan ----------

const blocking = [];
const notes = [];
const writes = []; // { ref, kind: 'create' | 'update', data, before }

const existingCouples = new Map(couples.map((c) => [c.id, c]));
const groups = new Map(); // coupleId -> [uid]
for (const u of users) {
  const coupleId = u.data.coupleId;
  if (typeof coupleId !== 'string' || coupleId.length === 0) {
    notes.push(`User ${u.id} (${u.data.email ?? authUsers.get(u.id)?.email ?? 'no e-mail'}) has no couple yet. They will see the join screen. Fine.`);
    continue;
  }
  groups.set(coupleId, [...(groups.get(coupleId) ?? []), u.id]);
}

for (const [coupleId, memberUids] of groups) {
  const existing = existingCouples.get(coupleId);
  const current = Array.isArray(existing?.data.members) ? existing.data.members : [];
  const union = [...new Set([...current, ...memberUids])].sort();

  if (union.length > MAX_MEMBERS) {
    blocking.push(`Couple ${coupleId} would have ${union.length} members (${union.join(', ')}). The rules allow at most ${MAX_MEMBERS}. Decide who belongs, then fix the profiles by hand.`);
    continue;
  }
  for (const uid of union) {
    if (!authUsers.has(uid)) notes.push(`Member ${uid} of couple ${coupleId} has no sign-in account (it may have been deleted).`);
  }

  if (!existing) {
    const createdBy = union.includes(coupleId) ? coupleId : union[0];
    writes.push({ ref: db.collection('couples').doc(coupleId), kind: 'create', before: null, data: { members: union, createdAt: Date.now(), createdBy }, summary: `create couples/${coupleId} with members [${union.join(', ')}]` });
  } else if (union.length !== current.length || union.some((m, i) => m !== [...current].sort()[i])) {
    writes.push({ ref: existing.ref, kind: 'update', before: existing.data, data: { members: union }, summary: `update couples/${coupleId}: members [${current.join(', ')}] -> [${union.join(', ')}]` });
  }
}

for (const u of users) {
  const auth = authUsers.get(u.id);
  const fill = {};
  if (u.data.uid === undefined) fill.uid = u.id;
  if (u.data.email === undefined && auth?.email) fill.email = auth.email;
  if (u.data.email !== undefined && auth?.email && u.data.email !== auth.email) {
    notes.push(`User ${u.id}: profile e-mail "${u.data.email}" differs from the sign-in e-mail "${auth.email}". Left as is, but the rules compare against the sign-in e-mail when the profile is written.`);
  }
  if (Object.keys(fill).length > 0) {
    writes.push({ ref: u.ref, kind: 'update', before: u.data, data: fill, summary: `fill users/${u.id}: ${Object.entries(fill).map(([k, v]) => `${k}=${v}`).join(', ')}` });
  }
}
for (const uid of authUsers.keys()) {
  if (!users.some((u) => u.id === uid)) notes.push(`Sign-in account ${uid} (${authUsers.get(uid).email}) has no user profile. It will get one when they next sign up or join. Fine.`);
}

const knownCoupleIds = new Set([...groups.keys(), ...existingCouples.keys()]);
for (const [coupleId, counts] of dataCoupleIds) {
  if (!knownCoupleIds.has(coupleId)) {
    const text = `Data with coupleId ${JSON.stringify(coupleId)} (${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ')}) belongs to no couple. Under the strict rules nobody could read it.`;
    (allowOrphans ? notes : blocking).push(text + (allowOrphans ? ' (allowed by --allow-orphans)' : ' Use --allow-orphans to proceed anyway.'));
  }
}

// ---------- report ----------

console.log('Plan');
if (writes.length === 0) console.log('  nothing to change: the database is already prepared.');
for (const w of writes) console.log(`  - ${w.summary}`);
if (notes.length) { console.log('\nNotes'); for (const n of notes) console.log(`  - ${n}`); }
if (blocking.length) {
  console.log('\nProblems that must be fixed first');
  for (const b of blocking) console.log(`  ! ${b}`);
  fail('Nothing was written.');
}

if (!apply) {
  console.log(`\nDry run: nothing was written.${writes.length ? ' Run again with --apply to make these changes.' : ''}\n`);
  process.exit(0);
}
if (writes.length === 0) process.exit(0);

// ---------- apply ----------

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.resolve(option('--out', path.join(here, '..', 'backups', `migration-${stamp}`)));
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'before.json'), JSON.stringify(writes.map((w) => ({ path: w.ref.path, kind: w.kind, before: w.before, applied: w.data })), null, 2));
console.log(`\nSaved the previous state of the ${writes.length} documents to:\n  ${outDir}\\before.json`);

const batch = db.batch();
for (const w of writes) (w.kind === 'create' ? batch.create(w.ref, w.data) : batch.update(w.ref, w.data));
await batch.commit();

// ---------- verify ----------

let problems = 0;
for (const w of writes) {
  const after = (await w.ref.get()).data();
  for (const [key, value] of Object.entries(w.data)) {
    if (JSON.stringify(after?.[key]) !== JSON.stringify(value)) { problems++; console.error(`  MISMATCH ${w.ref.path}.${key}`); }
  }
}
if (problems) fail(`${problems} values did not read back correctly. The previous state is in before.json.`);
console.log(`\nDone. ${writes.length} documents written and verified. No cities, places, memories or photos were touched.\n`);
