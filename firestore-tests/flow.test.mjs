// Replays what the app does, call by call, under the real rules: sign-up, starting a couple, inviting and joining,
// adding cities/places/memories, the delete cascades, and the situation of the existing (migrated) couple.
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  addDoc, arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch,
} from 'firebase/firestore';
import { after, before, beforeEach, describe, it } from 'node:test';
import { NOW, PHOTO, as, getEnv, reset, seed, stop } from './helpers.mjs';

before(getEnv);
after(stop);
beforeEach(reset);

const DAY = 24 * 3600e3;

describe('a new couple, from sign-up to a shared map', () => {
  it('works end to end', async () => {
    const ann = { uid: 'ann-uid-0000000000000000000000', email: 'ann@example.com' };
    const ben = { uid: 'ben-uid-0000000000000000000000', email: 'ben@example.com' };
    const annDb = await as(ann);
    const benDb = await as(ben);

    // LoginScreen.handleSignUp -> createUserDocument (getDoc, then setDoc)
    const profileRef = doc(annDb, 'users', ann.uid);
    await assertSucceeds(getDoc(profileRef));
    await assertSucceeds(setDoc(profileRef, { uid: ann.uid, email: ann.email, coupleId: null }));
    await assertSucceeds(setDoc(doc(benDb, 'users', ben.uid), { uid: ben.uid, email: ben.email, coupleId: null }));

    // LinkAccountScreen "Start on my own" -> createSoloCouple
    const couple = doc(collection(annDb, 'couples'));
    const solo = writeBatch(annDb);
    solo.set(couple, { members: [ann.uid], createdAt: NOW(), createdBy: ann.uid });
    solo.set(doc(annDb, 'users', ann.uid), { uid: ann.uid, email: ann.email, coupleId: couple.id }, { merge: true });
    await assertSucceeds(solo.commit());

    // Ann adds a city, a place and a memory (unlockCity, savePlace, saveMemoryLog)
    await assertSucceeds(addDoc(collection(annDb, 'unlocked_cities'), {
      coupleId: couple.id, cityId: 'osm_1', name: 'Kaunas, Lietuva', latitude: 54.89, longitude: 23.9, unlockedAt: NOW(),
    }));
    const place = await assertSucceeds(addDoc(collection(annDb, 'saved_places'), {
      coupleId: couple.id, cityId: 'osm_1', placeId: 4242, name: 'Old Town', fullName: 'Old Town, Kaunas', lat: '54.9', lon: '23.9', addedAt: NOW(),
    }));
    await assertSucceeds(addDoc(collection(annDb, 'visited_logs'), {
      coupleId: couple.id, cityId: 'osm_1', placeId: 4242, notes: 'Great', dateVisited: NOW(), photoUrls: [PHOTO], createdBy: ann.uid,
    }));

    // Ben cannot see any of it yet
    await assertFails(getDocs(query(collection(benDb, 'saved_places'), where('coupleId', '==', couple.id))));

    // Menu -> Sync: createInvite (ensureCouple reads the couple, then the invite id is checked, then created)
    await assertSucceeds(getDoc(doc(annDb, 'couples', couple.id)));
    await assertSucceeds(getDoc(doc(annDb, 'invites', 'H4R8T2W6YZ')));
    await assertSucceeds(setDoc(doc(annDb, 'invites', 'H4R8T2W6YZ'), {
      coupleId: couple.id, createdBy: ann.uid, createdAt: NOW(), expiresAt: NOW() + DAY, used: false,
    }));

    // Ben: joinWithInvite (reads the invite, then one batch)
    await assertSucceeds(getDoc(doc(benDb, 'invites', 'H4R8T2W6YZ')));
    const join = writeBatch(benDb);
    join.update(doc(benDb, 'couples', couple.id), { members: arrayUnion(ben.uid), joinCode: 'H4R8T2W6YZ' });
    join.update(doc(benDb, 'invites', 'H4R8T2W6YZ'), { used: true, usedBy: ben.uid, usedAt: NOW() });
    join.set(doc(benDb, 'users', ben.uid), { uid: ben.uid, email: ben.email, coupleId: couple.id }, { merge: true });
    await assertSucceeds(join.commit());

    // Now Ben sees and edits the shared map: the queries the app runs
    const places = await assertSucceeds(getDocs(query(collection(benDb, 'saved_places'), where('coupleId', '==', couple.id))));
    if (places.size !== 1) throw new Error('Ben should see Ann\'s place');
    await assertSucceeds(getDocs(query(collection(benDb, 'unlocked_cities'), where('coupleId', '==', couple.id))));
    await assertSucceeds(getDocs(query(collection(benDb, 'visited_logs'), where('coupleId', '==', couple.id))));
    await assertSucceeds(getDocs(query(collection(benDb, 'visited_logs'), where('coupleId', '==', couple.id), where('placeId', '==', 4242))));
    await assertSucceeds(updateDoc(doc(benDb, 'saved_places', place.id), { rating: 4.5 }));
    await assertSucceeds(addDoc(collection(benDb, 'visited_logs'), {
      coupleId: couple.id, cityId: 'osm_1', placeId: 4242, notes: 'Me too', dateVisited: NOW(), photoUrls: [], createdBy: ben.uid,
    }));

    // Sync tab: getCoupleMembers reads the couple and each member's profile
    await assertSucceeds(getDoc(doc(benDb, 'couples', couple.id)));
    await assertSucceeds(getDoc(doc(benDb, 'users', ann.uid)));
    await assertSucceeds(getDoc(doc(annDb, 'users', ben.uid)));

    // deleteUnlockedCity: query each collection by coupleId + cityId, delete every document
    for (const name of ['unlocked_cities', 'saved_places', 'visited_logs']) {
      const snap = await assertSucceeds(getDocs(query(collection(annDb, name), where('coupleId', '==', couple.id), where('cityId', '==', 'osm_1'))));
      await assertSucceeds(Promise.all(snap.docs.map((d) => deleteDoc(d.ref))));
    }
    // deleteSavedPlace: memories by coupleId + placeId
    await assertSucceeds(getDocs(query(collection(annDb, 'visited_logs'), where('coupleId', '==', couple.id), where('placeId', '==', 4242))));
  });
});

describe('the existing couple after the migration (the couple id is a 28-character uid)', () => {
  const ME = { uid: 'gEm3w326HBgJ4cNiu4ofMNgY3oA2', email: 'me@example.com' };
  const HER = { uid: 'BTkGGGP0XZhtfWkMep1h5xSom0A2', email: 'her@example.com' };
  const COUPLE = ME.uid;

  beforeEach(() => seed(async (db) => {
    await setDoc(doc(db, 'couples', COUPLE), { members: [ME.uid, HER.uid].sort(), createdAt: NOW(), createdBy: ME.uid });
    await setDoc(doc(db, 'users', ME.uid), { uid: ME.uid, email: ME.email, coupleId: COUPLE });
    await setDoc(doc(db, 'users', HER.uid), { uid: HER.uid, email: HER.email, coupleId: COUPLE });
    // data exactly as it exists today: slug city ids, string lat/lon, one photo per memory
    await setDoc(doc(db, 'unlocked_cities', 'c1'), { cityId: 'plunge', coupleId: COUPLE, latitude: 55.9113, longitude: 21.8442, name: 'Plungė', unlockedAt: 1788199923861 });
    await setDoc(doc(db, 'saved_places', 'p1'), { coupleId: COUPLE, cityId: 'plunge', placeId: 123456, name: 'Cafe', fullName: 'Cafe, Plungė', lat: '55.91', lon: '21.84', addedAt: 1788199923861, rating: 4 });
    await setDoc(doc(db, 'visited_logs', 'l1'), { coupleId: COUPLE, cityId: 'plunge', placeId: 123456, notes: 'Nice', dateVisited: 1788199923861, photoUrls: [PHOTO], createdBy: HER.uid });
  }));

  it('both of them keep full access to everything', async () => {
    for (const user of [ME, HER]) {
      const db = await as(user);
      for (const name of ['unlocked_cities', 'saved_places', 'visited_logs']) {
        await assertSucceeds(getDocs(query(collection(db, name), where('coupleId', '==', COUPLE))));
      }
      await assertSucceeds(getDocs(query(collection(db, 'visited_logs'), where('coupleId', '==', COUPLE), where('placeId', '==', 123456))));
      await assertSucceeds(getDoc(doc(db, 'couples', COUPLE)));
      await assertSucceeds(getDoc(doc(db, 'users', ME.uid)));
      await assertSucceeds(getDoc(doc(db, 'users', HER.uid)));
    }
  });

  it('they can keep using every feature: rate, re-date, add, delete', async () => {
    const db = await as(ME);
    await assertSucceeds(updateDoc(doc(db, 'saved_places', 'p1'), { rating: 5 }));
    await assertSucceeds(updateDoc(doc(db, 'visited_logs', 'l1'), { dateVisited: 1700000000000 }));
    await assertSucceeds(addDoc(collection(db, 'visited_logs'), { coupleId: COUPLE, cityId: 'plunge', placeId: 123456, notes: '', dateVisited: NOW(), photoUrls: [PHOTO], createdBy: ME.uid }));
    await assertSucceeds(deleteDoc(doc(db, 'visited_logs', 'l1')));
  });

  it('a stranger who knows the old couple id (the first partner\'s uid) gets nothing', async () => {
    const eve = { uid: 'eve-uid-00000000000000000000000', email: 'eve@example.com' };
    const db = await as(eve);
    await assertFails(getDocs(query(collection(db, 'saved_places'), where('coupleId', '==', COUPLE))));
    await assertFails(getDoc(doc(db, 'couples', COUPLE)));
    await assertFails(addDoc(collection(db, 'visited_logs'), { coupleId: COUPLE, cityId: 'x', placeId: 1, notes: 'spam', dateVisited: 1, photoUrls: [], createdBy: eve.uid }));
    await assertFails(setDoc(doc(db, 'users', eve.uid), { uid: eve.uid, email: eve.email, coupleId: COUPLE }));
    await assertFails(updateDoc(doc(db, 'users', eve.uid), { coupleId: COUPLE }));
    await assertFails(setDoc(doc(db, 'couples', COUPLE), { members: [eve.uid], createdAt: NOW(), createdBy: eve.uid }));
  });

  it('either of them can invite a third device or account only into their own couple, and it is already full', async () => {
    const db = await as(ME);
    // creating the invite is allowed (the app hides the button while the couple has two members)
    await assertSucceeds(setDoc(doc(db, 'invites', 'H4R8T2W6YZ'), { coupleId: COUPLE, createdBy: ME.uid, createdAt: NOW(), expiresAt: NOW() + DAY, used: false }));
    const eve = { uid: 'eve-uid-00000000000000000000000', email: 'eve@example.com' };
    const eveDb = await as(eve);
    const batch = writeBatch(eveDb);
    batch.update(doc(eveDb, 'couples', COUPLE), { members: arrayUnion(eve.uid), joinCode: 'H4R8T2W6YZ' });
    batch.update(doc(eveDb, 'invites', 'H4R8T2W6YZ'), { used: true, usedBy: eve.uid, usedAt: NOW() });
    batch.set(doc(eveDb, 'users', eve.uid), { uid: eve.uid, email: eve.email, coupleId: COUPLE }, { merge: true });
    await assertFails(batch.commit()); // a couple never exceeds two members
  });
});
