// Runs the app's REAL service code (src/services/firestoreService.ts, unchanged) against the strict rules, acting as
// different signed-in users. If the app writes something the rules reject, or reads something they hide, this fails.
import { assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { actAs } from './support/stub-config.mjs';
import { NOW, PHOTO, as, getEnv, reset, seed, stop } from './helpers.mjs';

const svc = await import('../src/services/firestoreService.ts');

const ANN = { uid: 'ann-uid-0000000000000000000000', email: 'ann@example.com' };
const BEN = { uid: 'ben-uid-0000000000000000000000', email: 'ben@example.com' };
const EVE = { uid: 'eve-uid-0000000000000000000000', email: 'eve@example.com' };
const act = async (user) => actAs(await as(user));

before(getEnv);
after(stop);
beforeEach(reset);

describe('the app\'s service layer under the strict rules', () => {
  it('a new couple: sign-up, solo couple, invite, join, shared map, deletes', async () => {
    // LoginScreen sign-up
    await act(ANN);
    await svc.createUserDocument(ANN.uid, ANN.email);
    assert.deepEqual(await svc.getUserProfile(ANN.uid), { uid: ANN.uid, email: ANN.email, coupleId: null });
    await act(BEN);
    await svc.createUserDocument(BEN.uid, BEN.email);

    // Ann starts a couple, adds data
    await act(ANN);
    const coupleId = await svc.createSoloCouple(ANN.uid, ANN.email);
    assert.equal((await svc.getUserProfile(ANN.uid)).coupleId, coupleId);
    await svc.unlockCity(coupleId, { id: 'osm_1', name: 'Kaunas, Lietuva', latitude: 54.89, longitude: 23.9 });
    await svc.savePlace(coupleId, 'osm_1', { place_id: 4242, name: 'Old Town', display_name: 'Old Town, Kaunas', lat: '54.9', lon: '23.9' });
    await svc.savePlace(coupleId, 'osm_1', { place_id: 'poi_1700000000000', name: '', display_name: 'Selected Place', lat: '54.91', lon: '23.91' });
    await svc.savePlace(coupleId, 'osm_1', { place_id: 'photon_W1', name: 'Cafe', display_name: 'Cafe, Kaunas, Lithuania', lat: '54.92', lon: '23.92' });
    await svc.saveMemoryLog({ coupleId, cityId: 'osm_1', placeId: 4242, notes: 'Great', dateVisited: NOW(), photoUrls: [PHOTO], createdBy: ANN.uid });
    await svc.saveMemoryLog({ coupleId, cityId: 'osm_1', placeId: 4242, notes: 'Text only', dateVisited: NOW(), photoUrls: [], createdBy: ANN.uid });

    // Ben cannot see it, and cannot write into it
    await act(BEN);
    await assert.rejects(svc.getAllSavedPlaces(coupleId), /permission|insufficient/i);
    await assert.rejects(svc.getUnlockedCities(coupleId), /permission|insufficient/i);

    // Ann invites Ben (Sync tab), Ben joins (join screen)
    await act(ANN);
    const invite = await svc.createInvite(ANN.uid, coupleId);
    await act(BEN);
    assert.equal(await svc.joinWithInvite(BEN.uid, BEN.email, invite.displayCode.toLowerCase()), coupleId);
    assert.equal((await svc.getUserProfile(BEN.uid)).coupleId, coupleId);

    // Ben now has the whole shared map and can work with it
    assert.equal((await svc.getUnlockedCities(coupleId)).length, 1);
    const places = await svc.getAllSavedPlaces(coupleId);
    assert.equal(places.length, 3);
    assert.equal((await svc.getCityPlaces(coupleId, 'osm_1')).length, 3);
    assert.equal((await svc.getAllCoupleMemories(coupleId)).length, 2);
    assert.equal((await svc.getPlaceMemories(coupleId, 4242)).length, 2);
    assert.equal((await svc.getCityMemories(coupleId, 'osm_1')).length, 2);
    const oldTown = places.find((p) => p.placeId === 4242);
    await svc.updatePlaceRating(oldTown.id, 4.5);
    const [memory] = await svc.getPlaceMemories(coupleId, 4242);
    await svc.updateMemoryDate(memory.id, 1700000000000);
    await svc.saveMemoryLog({ coupleId, cityId: 'osm_1', placeId: 4242, notes: 'Me too', dateVisited: NOW(), photoUrls: [], createdBy: BEN.uid });
    await svc.deleteMemoryLog(memory.id);

    // Sync tab on both phones
    const members = await svc.getCoupleMembers(BEN.uid, coupleId);
    assert.deepEqual(members.map((m) => m.email).sort(), [ANN.email, BEN.email]);
    await act(ANN);
    assert.equal((await svc.getCoupleMembers(ANN.uid, coupleId)).length, 2);

    // the invite is single use
    await act({ uid: 'dave-uid-0000000000000000000000', email: 'dave@example.com' });
    await assert.rejects(svc.joinWithInvite('dave-uid-0000000000000000000000', 'dave@example.com', invite.code), /already been used|permission/i);

    // deleting a place removes its memories; deleting the city removes everything in it
    await act(BEN);
    await svc.deleteSavedPlace(oldTown.id, coupleId, 4242);
    assert.equal((await svc.getPlaceMemories(coupleId, 4242)).length, 0);
    await svc.deleteUnlockedCity(coupleId, 'osm_1');
    assert.equal((await svc.getAllSavedPlaces(coupleId)).length, 0);
    assert.equal((await svc.getUnlockedCities(coupleId)).length, 0);
  });

  it('the existing couple after migration keeps working with the unchanged service code', async () => {
    const ME = { uid: 'gEm3w326HBgJ4cNiu4ofMNgY3oA2', email: 'me@example.com' };
    const HER = { uid: 'BTkGGGP0XZhtfWkMep1h5xSom0A2', email: 'her@example.com' };
    await seed(async (db) => {
      await setDoc(doc(db, 'couples', ME.uid), { members: [ME.uid, HER.uid].sort(), createdAt: NOW(), createdBy: ME.uid });
      await setDoc(doc(db, 'users', ME.uid), { uid: ME.uid, email: ME.email, coupleId: ME.uid });
      await setDoc(doc(db, 'users', HER.uid), { uid: HER.uid, email: HER.email, coupleId: ME.uid });
      await setDoc(doc(db, 'unlocked_cities', 'c1'), { cityId: 'plunge', coupleId: ME.uid, latitude: 55.9113, longitude: 21.8442, name: 'Plungė', unlockedAt: 1788199923861 });
      await setDoc(doc(db, 'saved_places', 'p1'), { coupleId: ME.uid, cityId: 'plunge', placeId: 123456, name: 'Cafe', fullName: 'Cafe, Plungė', lat: '55.91', lon: '21.84', addedAt: 1788199923861 });
      await setDoc(doc(db, 'visited_logs', 'l1'), { coupleId: ME.uid, cityId: 'plunge', placeId: 123456, notes: 'Nice', dateVisited: 1788199923861, photoUrls: [PHOTO], createdBy: HER.uid });
    });

    for (const user of [ME, HER]) {
      await act(user);
      // index.tsx on launch
      assert.equal((await svc.getUserProfile(user.uid)).coupleId, ME.uid);
      assert.equal((await svc.getUnlockedCities(ME.uid)).length, 1);
      assert.equal((await svc.getAllSavedPlaces(ME.uid)).length, 1);
      assert.equal((await svc.getAllCoupleMemories(ME.uid)).length, 1);
      assert.equal((await svc.getCoupleMembers(user.uid, ME.uid)).length, 2);
    }
    await act(ME);
    await svc.updatePlaceRating('p1', 5);
    await svc.updateMemoryDate('l1', 1700000000000);
    await svc.savePlace(ME.uid, 'plunge', { place_id: 777, name: 'Park', display_name: 'Park, Plungė', lat: '55.9', lon: '21.8' });
    await svc.saveMemoryLog({ coupleId: ME.uid, cityId: 'plunge', placeId: 777, notes: 'Walk', dateVisited: NOW(), photoUrls: [], createdBy: ME.uid });
    // a stranger who knows the old couple id gets nothing
    await act(EVE);
    await assert.rejects(svc.getAllSavedPlaces(ME.uid), /permission|insufficient/i);
    await assert.rejects(svc.getCoupleMembers(EVE.uid, ME.uid), /permission|insufficient/i);
    await assert.rejects(svc.joinWithInvite(EVE.uid, EVE.email, 'ZZZZZ-ZZZZZ'), /Invalid code|permission/i);
  });

  it('invites: the app\'s validation messages still apply, and rules stop the cheats', async () => {
    await act(ANN);
    await svc.createUserDocument(ANN.uid, ANN.email);
    const coupleId = await svc.createSoloCouple(ANN.uid, ANN.email);
    const invite = await svc.createInvite(ANN.uid, coupleId);
    await assert.rejects(svc.joinWithInvite(ANN.uid, ANN.email, invite.code), /You created this code/);
    await act(EVE);
    await svc.createUserDocument(EVE.uid, EVE.email);
    // Eve tries to join without the app's batch, directly marking the invite used
    const db = await as(EVE);
    const { updateDoc, doc: d } = await import('firebase/firestore');
    await assertFails(updateDoc(d(db, 'invites', invite.code), { used: true, usedBy: EVE.uid, usedAt: NOW() }));
    assert.equal((await svc.joinWithInvite(EVE.uid, EVE.email, invite.code)), coupleId);
  });
});
