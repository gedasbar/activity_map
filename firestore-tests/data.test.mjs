// Cities, places and memories: only the couple's members can touch them, and only with valid shapes.
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  ALICE, BOB, C1, C2, EVE, PHOTO, anon, as, getEnv, reset, seed, seedWorld, stop, validCity, validLog, validPlace,
} from './helpers.mjs';

before(getEnv);
after(stop);
beforeEach(async () => { await reset(); await seedWorld(); });

const COLLECTIONS = {
  unlocked_cities: validCity,
  saved_places: validPlace,
  visited_logs: (coupleId) => validLog(coupleId, ALICE.uid),
};

for (const [name, make] of Object.entries(COLLECTIONS)) {
  describe(name, () => {
    const seedDoc = (id = 'd1', coupleId = C1) => seed((db) => setDoc(doc(db, name, id), make(coupleId)));

    it('members can list with the app\'s queries', async () => {
      await seedDoc();
      const db = await as(BOB);
      await assertSucceeds(getDocs(query(collection(db, name), where('coupleId', '==', C1))));
      await assertSucceeds(getDocs(query(collection(db, name), where('coupleId', '==', C1), where('cityId', '==', 'osm_123'))));
      await assertSucceeds(getDocs(query(collection(db, name), where('coupleId', '==', C1), where('placeId', '==', 98765))));
      await assertSucceeds(getDoc(doc(db, name, 'd1')));
    });

    it('a stranger cannot read or list a couple\'s data', async () => {
      await seedDoc();
      const db = await as(EVE);
      await assertFails(getDoc(doc(db, name, 'd1')));
      await assertFails(getDocs(query(collection(db, name), where('coupleId', '==', C1))));
      await assertFails(getDocs(query(collection(db, name), where('coupleId', '==', C1), where('cityId', '==', 'osm_123'))));
    });

    it('nobody can list everything', async () => {
      await seedDoc();
      await assertFails(getDocs(collection(await as(ALICE), name)));
      await assertFails(getDocs(collection(await anon(), name)));
    });

    it('signed-out users cannot read, create or delete', async () => {
      await seedDoc();
      const db = await anon();
      await assertFails(getDoc(doc(db, name, 'd1')));
      await assertFails(addDoc(collection(db, name), make(C1)));
      await assertFails(deleteDoc(doc(db, name, 'd1')));
    });

    it('members can create into their own couple', async () => {
      await assertSucceeds(addDoc(collection(await as(ALICE), name), make(C1)));
    });

    it('a stranger cannot create into someone else\'s couple', async () => {
      await assertFails(addDoc(collection(await as(EVE), name), make(C1)));
    });

    it('a member cannot create into a couple they are not in', async () => {
      await assertFails(addDoc(collection(await as(ALICE), name), make(C2)));
    });

    it('a made-up couple id is rejected', async () => {
      await assertFails(addDoc(collection(await as(ALICE), name), make('no-such-couple')));
    });

    it('members can delete, strangers cannot', async () => {
      await seedDoc();
      await assertFails(deleteDoc(doc(await as(EVE), name, 'd1')));
      await assertSucceeds(deleteDoc(doc(await as(BOB), name, 'd1')));
    });

    it('the couple of an existing document can never be changed', async () => {
      await seedDoc();
      await assertFails(updateDoc(doc(await as(ALICE), name, 'd1'), { coupleId: C2 }));
    });

    it('rejects unknown extra fields on create', async () => {
      await assertFails(addDoc(collection(await as(ALICE), name), { ...make(C1), isAdmin: true }));
    });

    it('rejects a missing field on create', async () => {
      const { cityId, ...incomplete } = make(C1);
      await assertFails(addDoc(collection(await as(ALICE), name), incomplete));
    });
  });
}

describe('unlocked_cities (shape and edits)', () => {
  const add = async (over) => addDoc(collection(await as(ALICE), 'unlocked_cities'), validCity(C1, over));

  it('rejects out-of-range coordinates, empty or huge names', async () => {
    await assertFails(add({ latitude: 91 }));
    await assertFails(add({ longitude: -181 }));
    await assertFails(add({ name: '' }));
    await assertFails(add({ name: 'x'.repeat(201) }));
    await assertFails(add({ latitude: '54.68' }));
  });

  it('accepts the slug city ids the old data uses', async () => {
    await assertSucceeds(add({ cityId: 'plunge' }));
  });

  it('cities are never updated', async () => {
    await seed((db) => setDoc(doc(db, 'unlocked_cities', 'c1'), validCity(C1)));
    await assertFails(updateDoc(doc(await as(ALICE), 'unlocked_cities', 'c1'), { name: 'Renamed' }));
  });
});

describe('saved_places (shape and edits)', () => {
  const add = async (over) => addDoc(collection(await as(ALICE), 'saved_places'), validPlace(C1, over));
  const seedPlace = () => seed((db) => setDoc(doc(db, 'saved_places', 'p1'), validPlace(C1)));

  it('accepts numeric and string place ids', async () => {
    await assertSucceeds(add({ placeId: 12345 }));
    await assertSucceeds(add({ placeId: 'poi_1700000000000' }));
    await assertSucceeds(add({ placeId: 'custom_1700000000000' }));
    await assertSucceeds(add({ placeId: 'photon_W4853624' }));
  });

  it('rejects oversize text and numeric coordinates', async () => {
    await assertFails(add({ name: 'x'.repeat(201) }));
    await assertFails(add({ fullName: 'x'.repeat(501) }));
    await assertFails(add({ lat: 54.68 }));
    await assertFails(add({ lon: '' }));
  });

  it('members can rate a place from 0 to 5', async () => {
    await seedPlace();
    const ref = doc(await as(BOB), 'saved_places', 'p1');
    await assertSucceeds(updateDoc(ref, { rating: 4.5 }));
    await assertSucceeds(updateDoc(ref, { rating: 0 }));
    await assertFails(updateDoc(ref, { rating: 6 }));
    await assertFails(updateDoc(ref, { rating: -1 }));
    await assertFails(updateDoc(ref, { rating: '5' }));
  });

  it('a stranger cannot rate', async () => {
    await seedPlace();
    await assertFails(updateDoc(doc(await as(EVE), 'saved_places', 'p1'), { rating: 5 }));
  });

  it('only the rating can be edited', async () => {
    await seedPlace();
    const ref = doc(await as(ALICE), 'saved_places', 'p1');
    await assertFails(updateDoc(ref, { name: 'Renamed' }));
    await assertFails(updateDoc(ref, { rating: 5, name: 'Renamed' }));
    await assertFails(updateDoc(ref, { cityId: 'other' }));
  });
});

describe('visited_logs (shape and edits)', () => {
  const add = async (over, by = ALICE) => addDoc(collection(await as(by), 'visited_logs'), validLog(C1, by.uid, over));
  const seedLog = (over = {}) => seed((db) => setDoc(doc(db, 'visited_logs', 'l1'), validLog(C1, ALICE.uid, over)));

  it('accepts a note with no photo, and a photo with no note', async () => {
    await assertSucceeds(add({ photoUrls: [] }));
    await assertSucceeds(add({ notes: '' }));
  });

  it('createdBy must be the caller', async () => {
    await assertFails(addDoc(collection(await as(ALICE), 'visited_logs'), validLog(C1, BOB.uid)));
    await assertSucceeds(add({}, BOB));
  });

  it('only this app\'s Cloudinary photos, at most one per memory', async () => {
    await assertFails(add({ photoUrls: ['https://evil.example.com/tracker.png'] }));
    await assertFails(add({ photoUrls: ['https://res.cloudinary.com/someone-else/image/upload/x.jpg'] }));
    await assertFails(add({ photoUrls: [PHOTO, PHOTO] }));
    await assertFails(add({ photoUrls: [42] }));
    await assertFails(add({ photoUrls: PHOTO }));
  });

  it('rejects very long notes and bad dates', async () => {
    await assertFails(add({ notes: 'x'.repeat(5001) }));
    await assertSucceeds(add({ notes: 'x'.repeat(5000) }));
    await assertFails(add({ dateVisited: 'yesterday' }));
  });

  it('members can change the visit date and nothing else', async () => {
    await seedLog();
    const ref = doc(await as(BOB), 'visited_logs', 'l1');
    await assertSucceeds(updateDoc(ref, { dateVisited: 1600000000000 }));
    await assertFails(updateDoc(ref, { notes: 'edited' }));
    await assertFails(updateDoc(ref, { photoUrls: [] }));
    await assertFails(updateDoc(ref, { createdBy: BOB.uid }));
    await assertFails(updateDoc(ref, { dateVisited: 'x' }));
  });

  it('old documents with extra or missing fields can still be listed, re-dated and deleted', async () => {
    await seed((db) => setDoc(doc(db, 'visited_logs', 'old'), { coupleId: C1, cityId: 'plunge', notes: 'old', dateVisited: 1, photoUrls: [PHOTO, PHOTO], legacyField: true }));
    const db = await as(ALICE);
    await assertSucceeds(getDocs(query(collection(db, 'visited_logs'), where('coupleId', '==', C1))));
    await assertSucceeds(updateDoc(doc(db, 'visited_logs', 'old'), { dateVisited: 2 }));
    await assertSucceeds(deleteDoc(doc(db, 'visited_logs', 'old')));
  });
});
