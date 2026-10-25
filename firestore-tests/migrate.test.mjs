// scripts/migrate.mjs against the local emulators.
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { PHOTO, PROJECT_ID, as, getEnv, reset, stop } from './helpers.mjs';

const SCRIPT = new URL('../scripts/migrate.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ME = { uid: 'gEm3w326HBgJ4cNiu4ofMNgY3oA2', email: 'me@example.com' };
const HER = { uid: 'BTkGGGP0XZhtfWkMep1h5xSom0A2', email: 'her@example.com' };

if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID });
const fs = getFirestore();
const auth = getAuth();

const run = (...args) => {
  const out = mkdtempSync(path.join(tmpdir(), 'migrate-test-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--emulator', '--out', out, ...args], { encoding: 'utf8', env: process.env });
  return { status: r.status, text: (r.stdout ?? '') + (r.stderr ?? ''), out };
};
const get = async (p) => { const s = await fs.doc(p).get(); return s.exists ? s.data() : null; };
const snapshotData = async () => {
  const all = {};
  for (const name of ['unlocked_cities', 'saved_places', 'visited_logs']) {
    all[name] = (await fs.collection(name).get()).docs.map((d) => [d.id, d.data()]).sort();
  }
  return JSON.stringify(all);
};

const resetAuth = async () => { for (const u of (await auth.listUsers()).users) await auth.deleteUser(u.uid); };
const addAuthUser = (u) => auth.createUser({ uid: u.uid, email: u.email, password: 'password123' });

// The database as it is today: both profiles point at ME's uid; ME's profile has only coupleId; no couples documents.
const seedToday = async () => {
  await addAuthUser(ME);
  await addAuthUser(HER);
  await fs.doc(`users/${ME.uid}`).set({ coupleId: ME.uid });
  await fs.doc(`users/${HER.uid}`).set({ uid: HER.uid, email: HER.email, coupleId: ME.uid });
  await fs.doc('unlocked_cities/c1').set({ cityId: 'plunge', coupleId: ME.uid, latitude: 55.9113, longitude: 21.8442, name: 'Plungė', unlockedAt: 1788199923861 });
  await fs.doc('saved_places/p1').set({ coupleId: ME.uid, cityId: 'plunge', placeId: 123456, name: 'Cafe', fullName: 'Cafe, Plungė', lat: '55.91', lon: '21.84', addedAt: 1788199923861 });
  await fs.doc('visited_logs/l1').set({ coupleId: ME.uid, cityId: 'plunge', placeId: 123456, notes: 'Nice', dateVisited: 1788199923861, photoUrls: [PHOTO], createdBy: HER.uid });
  await fs.doc('visited_logs/l2').set({ coupleId: ME.uid, cityId: 'plunge', placeId: 123456, notes: '', dateVisited: 1788199923862, photoUrls: [], createdBy: ME.uid });
};

before(getEnv);
after(stop);
beforeEach(async () => { await reset(); await resetAuth(); });

describe('migration of the real situation', () => {
  it('dry run prints the plan and writes nothing', async () => {
    await seedToday();
    const r = run();
    assert.equal(r.status, 0, r.text);
    assert.match(r.text, /create couples\/gEm3w326HBgJ4cNiu4ofMNgY3oA2 with members/);
    assert.match(r.text, /fill users\/gEm3w326HBgJ4cNiu4ofMNgY3oA2: uid=.*, email=me@example.com/);
    assert.match(r.text, /Dry run: nothing was written/);
    assert.equal(await get(`couples/${ME.uid}`), null);
    assert.deepEqual(await get(`users/${ME.uid}`), { coupleId: ME.uid });
  });

  it('apply creates the couple, fills the profile, keeps a before-copy and leaves all data untouched', async () => {
    await seedToday();
    const dataBefore = await snapshotData();
    const r = run('--apply');
    assert.equal(r.status, 0, r.text);
    assert.match(r.text, /2 documents written and verified/);

    const couple = await get(`couples/${ME.uid}`);
    assert.deepEqual(couple.members, [ME.uid, HER.uid].sort());
    assert.equal(couple.createdBy, ME.uid);
    assert.equal(typeof couple.createdAt, 'number');
    assert.deepEqual(await get(`users/${ME.uid}`), { uid: ME.uid, email: ME.email, coupleId: ME.uid });
    assert.deepEqual(await get(`users/${HER.uid}`), { uid: HER.uid, email: HER.email, coupleId: ME.uid }); // untouched

    assert.equal(await snapshotData(), dataBefore, 'cities, places and memories must be byte-for-byte unchanged');

    const saved = JSON.parse(readFileSync(path.join(r.out, 'before.json'), 'utf8'));
    assert.equal(saved.length, 2);
    assert.deepEqual(saved.find((x) => x.path === `users/${ME.uid}`).before, { coupleId: ME.uid });
  });

  it('running it again changes nothing', async () => {
    await seedToday();
    assert.equal(run('--apply').status, 0);
    const before = JSON.stringify([await get(`couples/${ME.uid}`), await get(`users/${ME.uid}`)]);
    const again = run('--apply');
    assert.equal(again.status, 0, again.text);
    assert.match(again.text, /nothing to change/);
    assert.equal(existsSync(path.join(again.out, 'before.json')), false, 'no before-copy when there is nothing to write');
    assert.equal(JSON.stringify([await get(`couples/${ME.uid}`), await get(`users/${ME.uid}`)]), before);
  });

  it('after the migration the strict rules give the couple access and a stranger nothing', async () => {
    await seedToday();
    assert.equal(run('--apply').status, 0);
    for (const user of [ME, HER]) {
      const db = await as(user);
      await assertSucceeds(getDocs(query(collection(db, 'saved_places'), where('coupleId', '==', ME.uid))));
      await assertSucceeds(getDocs(query(collection(db, 'visited_logs'), where('coupleId', '==', ME.uid), where('placeId', '==', 123456))));
      await assertSucceeds(getDocs(query(collection(db, 'unlocked_cities'), where('coupleId', '==', ME.uid))));
      await assertSucceeds(getDoc(doc(db, 'couples', ME.uid)));
      await assertSucceeds(getDoc(doc(db, 'users', ME.uid)));
      await assertSucceeds(getDoc(doc(db, 'users', HER.uid)));
    }
    const eve = await as({ uid: 'eve', email: 'eve@example.com' });
    await assertFails(getDocs(query(collection(eve, 'saved_places'), where('coupleId', '==', ME.uid))));
    await assertFails(getDoc(doc(eve, 'couples', ME.uid)));
  });
});

describe('migration edge cases', () => {
  it('adds a missing member to a couple document that already exists', async () => {
    await seedToday();
    await fs.doc(`couples/${ME.uid}`).set({ members: [ME.uid], createdAt: 1, createdBy: ME.uid });
    const r = run('--apply');
    assert.equal(r.status, 0, r.text);
    assert.deepEqual((await get(`couples/${ME.uid}`)).members, [ME.uid, HER.uid].sort());
    assert.equal((await get(`couples/${ME.uid}`)).createdAt, 1, 'existing fields are preserved');
  });

  it('refuses a couple with more than two users, and writes nothing', async () => {
    await seedToday();
    const third = { uid: 'third-uid-000000000000000000000', email: 'third@example.com' };
    await addAuthUser(third);
    await fs.doc(`users/${third.uid}`).set({ uid: third.uid, email: third.email, coupleId: ME.uid });
    const r = run('--apply');
    assert.equal(r.status, 1);
    assert.match(r.text, /would have 3 members/);
    assert.equal(await get(`couples/${ME.uid}`), null);
    assert.deepEqual(await get(`users/${ME.uid}`), { coupleId: ME.uid });
  });

  it('refuses data that belongs to no couple unless told otherwise', async () => {
    await seedToday();
    await fs.doc('saved_places/stray').set({ coupleId: 'nobody-knows-this-one', cityId: 'x', placeId: 1, name: 'n', fullName: 'n', lat: '1', lon: '1', addedAt: 1 });
    const blocked = run('--apply');
    assert.equal(blocked.status, 1);
    assert.match(blocked.text, /belongs to no couple/);
    assert.equal(await get(`couples/${ME.uid}`), null, 'nothing written when blocked');
    const allowed = run('--apply', '--allow-orphans');
    assert.equal(allowed.status, 0, allowed.text);
    assert.notEqual(await get(`couples/${ME.uid}`), null);
    assert.notEqual(await get('saved_places/stray'), null, 'orphans are never deleted');
  });

  it('reports users without a couple and sign-in accounts without a profile, without failing', async () => {
    await seedToday();
    const lone = { uid: 'lone-uid-0000000000000000000000', email: 'lone@example.com' };
    await addAuthUser(lone);
    await fs.doc(`users/${lone.uid}`).set({ uid: lone.uid, email: lone.email, coupleId: null });
    await addAuthUser({ uid: 'ghost-uid-000000000000000000000', email: 'ghost@example.com' });
    const r = run();
    assert.equal(r.status, 0, r.text);
    assert.match(r.text, /has no couple yet/);
    assert.match(r.text, /has no user profile/);
  });

  it('warns about a member whose sign-in account is gone', async () => {
    await seedToday();
    await auth.deleteUser(HER.uid);
    const r = run();
    assert.equal(r.status, 0, r.text);
    assert.match(r.text, /has no sign-in account/);
  });

  it('never overwrites an e-mail that is already set, only reports a difference', async () => {
    await seedToday();
    await fs.doc(`users/${HER.uid}`).update({ email: 'old-address@example.com' });
    const r = run('--apply');
    assert.equal(r.status, 0, r.text);
    assert.match(r.text, /differs from the sign-in e-mail/);
    assert.equal((await get(`users/${HER.uid}`)).email, 'old-address@example.com');
  });

  it('refuses to run against the real project with the wrong key', async () => {
    const wrong = path.join(mkdtempSync(path.join(tmpdir(), 'key-')), 'key.json');
    (await import('node:fs')).writeFileSync(wrong, JSON.stringify({ project_id: 'some-other-project' }));
    const r = spawnSync(process.execPath, [SCRIPT, '--key', wrong], { encoding: 'utf8', env: { ...process.env, FIRESTORE_EMULATOR_HOST: '', FIREBASE_AUTH_EMULATOR_HOST: '' } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /uses "activity-map-155d8"/);
  });
});
