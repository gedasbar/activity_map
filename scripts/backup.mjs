// Read-only backup of everything the app stores: Firestore collections, the list of Auth users
// (no password hashes) and, optionally, the photo files from Cloudinary.
// It never writes to Firestore or Auth. See scripts/README.md.
//
//   node backup.mjs                  data only
//   node backup.mjs --photos         data and photo files
//   node backup.mjs --key path.json --out ../backups/my-folder

import admin from 'firebase-admin';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_PROJECT_ID = 'activity-map-155d8';
const COLLECTIONS = ['users', 'unlocked_cities', 'saved_places', 'visited_logs'];
const PHOTO_CONCURRENCY = 4;

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const keyPath = path.resolve(option('--key', path.join(here, 'serviceAccountKey.json')));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.resolve(option('--out', path.join(here, '..', 'backups', stamp)));
const withPhotos = flag('--photos');

const fail = (message) => {
  console.error(`\nError: ${message}\n`);
  process.exit(1);
};

// Firestore values that JSON cannot represent are written with a __type marker so nothing is lost.
const toPlain = (value) => {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof admin.firestore.Timestamp) return { __type: 'timestamp', iso: value.toDate().toISOString(), seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (value instanceof admin.firestore.GeoPoint) return { __type: 'geopoint', latitude: value.latitude, longitude: value.longitude };
  if (value instanceof admin.firestore.DocumentReference) return { __type: 'reference', path: value.path };
  if (Array.isArray(value)) return value.map(toPlain);
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toPlain(v)]));
};

const writeJson = async (file, data) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2), 'utf8');
};

let serviceAccount;
try {
  serviceAccount = JSON.parse(await readFile(keyPath, 'utf8'));
} catch {
  fail(`Could not read the service account key at:\n  ${keyPath}\nSee scripts/README.md, step 1.`);
}
if (serviceAccount.project_id !== EXPECTED_PROJECT_ID) {
  fail(`This key is for project "${serviceAccount.project_id}", but this app uses "${EXPECTED_PROJECT_ID}". Nothing was read.`);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

console.log(`Backing up project ${EXPECTED_PROJECT_ID}\nTo: ${outDir}\n`);

// 1. Firestore
const data = {};
for (const name of COLLECTIONS) {
  const snapshot = await db.collection(name).get();
  data[name] = snapshot.docs.map((doc) => ({ id: doc.id, data: toPlain(doc.data()) }));
  await writeJson(path.join(outDir, 'firestore', `${name}.json`), data[name]);
  console.log(`  ${name.padEnd(16)} ${String(data[name].length).padStart(5)} documents`);
}

// 2. Auth users (identifiers only; password hashes are deliberately left out)
const authUsers = [];
let pageToken;
do {
  const page = await admin.auth().listUsers(1000, pageToken);
  for (const u of page.users) {
    authUsers.push({
      uid: u.uid,
      email: u.email ?? null,
      emailVerified: u.emailVerified,
      disabled: u.disabled,
      createdAt: u.metadata.creationTime,
      lastSignInAt: u.metadata.lastSignInTime,
      providers: u.providerData.map((p) => p.providerId),
    });
  }
  pageToken = page.pageToken;
} while (pageToken);
await writeJson(path.join(outDir, 'auth-users.json'), authUsers);
console.log(`  ${'auth users'.padEnd(16)} ${String(authUsers.length).padStart(5)} accounts`);

// 3. Photos (optional)
const photoRefs = data.visited_logs.flatMap((log) =>
  (log.data.photoUrls ?? []).map((url, index) => ({ logId: log.id, index, url })),
);
console.log(`  ${'photo links'.padEnd(16)} ${String(photoRefs.length).padStart(5)} in memories`);

const extensionOf = (url) => {
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  return /^\.[a-z0-9]{2,5}$/.test(ext) ? ext : '.jpg';
};

const photoResults = { downloaded: 0, skipped: 0, failed: [] };
if (withPhotos && photoRefs.length > 0) {
  console.log(`\nDownloading ${photoRefs.length} photos...`);
  const queue = [...photoRefs];
  const worker = async () => {
    while (queue.length > 0) {
      const ref = queue.shift();
      const file = path.join(outDir, 'photos', `${ref.logId}-${ref.index}${extensionOf(ref.url)}`);
      try {
        if (await stat(file).then(() => true, () => false)) { photoResults.skipped++; continue; }
        const response = await fetch(ref.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, Buffer.from(await response.arrayBuffer()));
        photoResults.downloaded++;
      } catch (e) {
        photoResults.failed.push({ ...ref, error: String(e.message ?? e) });
      }
      const done = photoResults.downloaded + photoResults.skipped + photoResults.failed.length;
      if (done % 25 === 0 || done === photoRefs.length) console.log(`  ${done}/${photoRefs.length}`);
    }
  };
  await Promise.all(Array.from({ length: PHOTO_CONCURRENCY }, worker));
}

// 4. Sanity report: how the data hangs together (useful for planning the migration)
const userCoupleIds = new Map(data.users.map((u) => [u.id, u.data.coupleId ?? null]));
const coupleIdsInUse = new Set(userCoupleIds.values());
coupleIdsInUse.delete(null);
const orphanCounts = {};
for (const name of ['unlocked_cities', 'saved_places', 'visited_logs']) {
  const orphans = data[name].filter((d) => !coupleIdsInUse.has(d.data.coupleId));
  if (orphans.length) orphanCounts[name] = orphans.length;
}
const authUids = new Set(authUsers.map((u) => u.uid));
const report = {
  backedUpAt: new Date().toISOString(),
  projectId: EXPECTED_PROJECT_ID,
  counts: Object.fromEntries([...COLLECTIONS.map((c) => [c, data[c].length]), ['authUsers', authUsers.length], ['photoLinks', photoRefs.length]]),
  photos: withPhotos ? { downloaded: photoResults.downloaded, alreadyPresent: photoResults.skipped, failed: photoResults.failed } : 'not requested (use --photos)',
  coupleIdsInUse: [...coupleIdsInUse],
  userDocsWithoutAuthAccount: data.users.filter((u) => !authUids.has(u.id)).map((u) => ({ uid: u.id, email: u.data.email ?? null })),
  authAccountsWithoutUserDoc: authUsers.filter((u) => !userCoupleIds.has(u.uid)).map((u) => ({ uid: u.uid, email: u.email })),
  dataNotMatchingAnyUsersCoupleId: orphanCounts,
};
await writeJson(path.join(outDir, 'report.json'), report);

console.log('\nSummary');
console.log(`  couple ids in use:            ${report.coupleIdsInUse.length}`);
console.log(`  user docs without Auth login: ${report.userDocsWithoutAuthAccount.length}${report.userDocsWithoutAuthAccount.length ? '  (see report.json)' : ''}`);
console.log(`  Auth logins without user doc: ${report.authAccountsWithoutUserDoc.length}${report.authAccountsWithoutUserDoc.length ? '  (see report.json)' : ''}`);
console.log(`  data not tied to a user:      ${Object.keys(orphanCounts).length ? JSON.stringify(orphanCounts) : 'none'}`);
if (withPhotos) console.log(`  photos downloaded:            ${photoResults.downloaded} (${photoResults.skipped} already there, ${photoResults.failed.length} failed)`);
console.log(`\nDone. Backup is in:\n  ${outDir}\n`);
if (photoResults.failed.length > 0) process.exitCode = 2;
