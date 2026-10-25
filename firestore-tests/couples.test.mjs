// users, couples and invites, including the exact batched writes the app performs.
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { after, before, beforeEach, describe, it } from 'node:test';
import { ALICE, BOB, C1, C2, C3, CAROL, EVE, NOW, anon, as, getEnv, reset, seed, seedWorld, stop } from './helpers.mjs';

before(getEnv);
after(stop);
beforeEach(async () => { await reset(); await seedWorld(); });

const DAY = 24 * 3600e3;
const CODE = 'K7M2P9XQ4T';
const invite = (coupleId = C3, over = {}) => ({ coupleId, createdBy: CAROL.uid, createdAt: NOW(), expiresAt: NOW() + DAY, used: false, ...over });
const seedInvite = (code = CODE, over = {}, coupleId = C3) => seed((db) => setDoc(doc(db, 'invites', code), invite(coupleId, over)));

// firestoreService.joinWithInvite, step for step.
const joinBatch = (db, user, coupleId = C3, code = CODE) => {
  const batch = writeBatch(db);
  batch.update(doc(db, 'couples', coupleId), { members: arrayUnion(user.uid), joinCode: code });
  batch.update(doc(db, 'invites', code), { used: true, usedBy: user.uid, usedAt: NOW() });
  batch.set(doc(db, 'users', user.uid), { uid: user.uid, email: user.email, coupleId }, { merge: true });
  return batch;
};

describe('users', () => {
  it('you can read your own profile, even before it exists', async () => {
    await assertSucceeds(getDoc(doc(await as(ALICE), 'users', ALICE.uid)));
    await assertSucceeds(getDoc(doc(await as({ uid: 'newbie', email: 'n@example.com' }), 'users', 'newbie')));
  });

  it('you can read your partner\'s profile but not a stranger\'s', async () => {
    await assertSucceeds(getDoc(doc(await as(ALICE), 'users', BOB.uid)));
    await assertFails(getDoc(doc(await as(ALICE), 'users', EVE.uid)));
    await assertFails(getDoc(doc(await as(EVE), 'users', ALICE.uid)));
    await assertFails(getDoc(doc(await anon(), 'users', ALICE.uid)));
  });

  it('nobody can list users', async () => {
    await assertFails(getDocs(collection(await as(ALICE), 'users')));
  });

  it('sign-up creates your own profile (createUserDocument)', async () => {
    const me = { uid: 'newbie', email: 'n@example.com' };
    await assertSucceeds(setDoc(doc(await as(me), 'users', me.uid), { uid: me.uid, email: me.email, coupleId: null }));
  });

  it('you cannot create a profile for someone else, with someone else\'s email, or with extras', async () => {
    const me = { uid: 'newbie', email: 'n@example.com' };
    const db = await as(me);
    await assertFails(setDoc(doc(db, 'users', 'somebody-else'), { uid: 'somebody-else', email: me.email, coupleId: null }));
    await assertFails(setDoc(doc(db, 'users', me.uid), { uid: 'somebody-else', email: me.email, coupleId: null }));
    await assertFails(setDoc(doc(db, 'users', me.uid), { uid: me.uid, email: 'boss@example.com', coupleId: null }));
    await assertFails(setDoc(doc(db, 'users', me.uid), { uid: me.uid, email: me.email, coupleId: null, isAdmin: true }));
  });

  it('you cannot point yourself at a couple you are not in', async () => {
    const db = await as(EVE);
    await assertFails(updateDoc(doc(db, 'users', EVE.uid), { coupleId: C1 }));
    await assertFails(setDoc(doc(db, 'users', EVE.uid), { uid: EVE.uid, email: EVE.email, coupleId: C3 }, { merge: true }));
    await assertFails(setDoc(doc(db, 'users', EVE.uid), { uid: EVE.uid, email: EVE.email, coupleId: 'no-such-couple' }, { merge: true }));
  });

  it('nobody can change or delete another person\'s profile', async () => {
    await assertFails(updateDoc(doc(await as(EVE), 'users', ALICE.uid), { coupleId: C2 }));
    await assertFails(updateDoc(doc(await as(BOB), 'users', ALICE.uid), { email: 'x@example.com' }));
    await assertFails(deleteDoc(doc(await as(ALICE), 'users', ALICE.uid)));
  });

  it('an old profile with only a coupleId can be filled in with uid and email', async () => {
    await seed((db) => setDoc(doc(db, 'users', 'me-old'), { coupleId: C1 }));
    await seed((db) => setDoc(doc(db, 'couples', C1), { members: [ALICE.uid, BOB.uid, 'me-old'], createdAt: 1, createdBy: ALICE.uid }));
    const db = await as({ uid: 'me-old', email: 'old@example.com' });
    await assertSucceeds(setDoc(doc(db, 'users', 'me-old'), { uid: 'me-old', email: 'old@example.com', coupleId: C1 }, { merge: true }));
  });
});

describe('couples', () => {
  it('members can read their couple; strangers and signed-out users cannot', async () => {
    await assertSucceeds(getDoc(doc(await as(ALICE), 'couples', C1)));
    await assertSucceeds(getDoc(doc(await as(BOB), 'couples', C1)));
    await assertFails(getDoc(doc(await as(EVE), 'couples', C1)));
    await assertFails(getDoc(doc(await anon(), 'couples', C1)));
  });

  it('nobody can list couples', async () => {
    await assertFails(getDocs(collection(await as(ALICE), 'couples')));
  });

  it('starting alone (createSoloCouple) works', async () => {
    const me = { uid: 'newbie', email: 'n@example.com' };
    const db = await as(me);
    const batch = writeBatch(db);
    const couple = doc(collection(db, 'couples'));
    batch.set(couple, { members: [me.uid], createdAt: NOW(), createdBy: me.uid });
    batch.set(doc(db, 'users', me.uid), { uid: me.uid, email: me.email, coupleId: couple.id }, { merge: true });
    await assertSucceeds(batch.commit());
    await assertSucceeds(getDoc(doc(db, 'couples', couple.id)));
  });

  it('a new couple cannot start with other people in it, or with a spoofed creator', async () => {
    const db = await as(EVE);
    const id = 'couple-dddddddddddd0';
    await assertFails(setDoc(doc(db, 'couples', id), { members: [EVE.uid, ALICE.uid], createdAt: NOW(), createdBy: EVE.uid }));
    await assertFails(setDoc(doc(db, 'couples', id), { members: [ALICE.uid], createdAt: NOW(), createdBy: ALICE.uid }));
    await assertFails(setDoc(doc(db, 'couples', id), { members: [EVE.uid], createdAt: NOW(), createdBy: ALICE.uid }));
    await assertFails(setDoc(doc(db, 'couples', id), { members: [EVE.uid], createdAt: NOW(), createdBy: EVE.uid, joinCode: 'x' }));
  });

  it('nobody can claim a document named after someone else\'s uid', async () => {
    const victim = 'gEm3w326HBgJ4cNiu4ofMNgY3oA2';
    await assertFails(setDoc(doc(await as(EVE), 'couples', victim), { members: [EVE.uid], createdAt: NOW(), createdBy: EVE.uid }));
  });

  it('members cannot edit or delete the couple directly', async () => {
    const db = await as(ALICE);
    await assertFails(updateDoc(doc(db, 'couples', C1), { members: [ALICE.uid] }));
    await assertFails(updateDoc(doc(db, 'couples', C1), { members: arrayUnion('eve') }));
    await assertFails(deleteDoc(doc(db, 'couples', C1)));
  });

  it('a stranger cannot add themselves to a couple without an invite', async () => {
    await assertFails(updateDoc(doc(await as(EVE), 'couples', C3), { members: arrayUnion(EVE.uid), joinCode: CODE }));
    await seedInvite();
    // an invite exists, but the batch does not redeem it
    await assertFails(updateDoc(doc(await as(EVE), 'couples', C3), { members: arrayUnion(EVE.uid), joinCode: CODE }));
  });
});

describe('invites', () => {
  const create = async (user, code, data) => setDoc(doc(await as(user), 'invites', code), data);

  it('members create invites for their own couple', async () => {
    await assertSucceeds(create(CAROL, CODE, invite()));
  });

  it('only a member can create an invite for a couple', async () => {
    await assertFails(create(EVE, CODE, invite(C3, { createdBy: EVE.uid })));
    await assertFails(create(CAROL, CODE, invite(C2)));
    await assertFails(create(CAROL, CODE, invite('no-such-couple')));
  });

  it('rejects bad codes, bad lifetimes, spoofed creators, pre-used invites and extras', async () => {
    await assertFails(create(CAROL, 'short', invite()));
    await assertFails(create(CAROL, 'K7M2P9XQ4T0', invite())); // 11 characters
    await assertFails(create(CAROL, 'k7m2p9xq4t', invite())); // lower case
    await assertFails(create(CAROL, 'I1O0LLLLLL', invite())); // look-alike characters are not in the alphabet
    await assertFails(create(CAROL, CODE, invite(C3, { expiresAt: NOW() + 2 * DAY })));
    await assertFails(create(CAROL, CODE, invite(C3, { expiresAt: NOW() - 1000 })));
    await assertFails(create(CAROL, CODE, invite(C3, { createdBy: ALICE.uid })));
    await assertFails(create(CAROL, CODE, invite(C3, { used: true })));
    await assertFails(create(CAROL, CODE, invite(C3, { extra: 1 })));
  });

  it('an invite can be read by id by any signed-in user, never listed', async () => {
    await seedInvite();
    await assertSucceeds(getDoc(doc(await as(EVE), 'invites', CODE)));
    await assertFails(getDoc(doc(await anon(), 'invites', CODE)));
    await assertFails(getDocs(collection(await as(EVE), 'invites')));
    await assertFails(getDocs(collection(await as(CAROL), 'invites')));
  });

  it('only the creator can withdraw an invite', async () => {
    await seedInvite();
    await assertFails(deleteDoc(doc(await as(EVE), 'invites', CODE)));
    await assertSucceeds(deleteDoc(doc(await as(CAROL), 'invites', CODE)));
  });

  it('an invite cannot be marked used on its own', async () => {
    await seedInvite();
    // Eve burning Carol's invite without joining
    await assertFails(updateDoc(doc(await as(EVE), 'invites', CODE), { used: true, usedBy: EVE.uid, usedAt: NOW() }));
    // even a member of the couple cannot mark it used for someone who has not joined
    await assertFails(updateDoc(doc(await as(CAROL), 'invites', CODE), { used: true, usedBy: EVE.uid, usedAt: NOW() }));
  });
});

describe('joining with an invite (the app\'s batched write)', () => {
  it('works: member added, invite used, profile pointed at the couple', async () => {
    await seedInvite();
    const db = await as(EVE);
    await assertSucceeds(joinBatch(db, EVE).commit());
    const couple = (await getDoc(doc(db, 'couples', C3))).data();
    if (!couple.members.includes(EVE.uid) || couple.members.length !== 2) throw new Error('eve was not added');
  });

  it('after joining, the new member can read the couple\'s data and the partner profile; others still cannot', async () => {
    await seed((db) => setDoc(doc(db, 'unlocked_cities', 'c1'), { coupleId: C3, cityId: 'x', name: 'X', latitude: 1, longitude: 1, unlockedAt: 1 }));
    await seedInvite();
    await assertSucceeds(joinBatch(await as(EVE), EVE).commit());
    await assertSucceeds(getDoc(doc(await as(EVE), 'unlocked_cities', 'c1')));
    await assertSucceeds(getDoc(doc(await as(EVE), 'users', CAROL.uid)));
    await assertSucceeds(getDoc(doc(await as(CAROL), 'users', EVE.uid)));
    await assertFails(getDoc(doc(await as(BOB), 'unlocked_cities', 'c1')));
  });

  it('fails without the invite being marked used in the same batch', async () => {
    await seedInvite();
    const db = await as(EVE);
    const batch = writeBatch(db);
    batch.update(doc(db, 'couples', C3), { members: arrayUnion(EVE.uid), joinCode: CODE });
    batch.set(doc(db, 'users', EVE.uid), { uid: EVE.uid, email: EVE.email, coupleId: C3 }, { merge: true });
    await assertFails(batch.commit());
  });

  it('fails for an expired invite', async () => {
    await seedInvite(CODE, { expiresAt: NOW() - 1000 });
    await assertFails(joinBatch(await as(EVE), EVE).commit());
  });

  it('fails for a used invite (it works only once)', async () => {
    await seedInvite();
    await assertSucceeds(joinBatch(await as(EVE), EVE).commit());
    // a third person tries the same code; also nothing changes when it is replayed
    const dave = { uid: 'dave', email: 'dave@example.com' };
    await assertFails(joinBatch(await as(dave), dave).commit());
  });

  it('fails for an invite that belongs to a different couple', async () => {
    await seedInvite(CODE, {}, C3);
    const db = await as(EVE);
    const batch = writeBatch(db);
    batch.update(doc(db, 'couples', C2), { members: arrayUnion('zed'), joinCode: CODE });
    await assertFails(batch.commit());
    // joining couple C1 (already full) with carol's code
    await assertFails(joinBatch(await as({ uid: 'zed', email: 'z@example.com' }), { uid: 'zed', email: 'z@example.com' }, C1).commit());
  });

  it('fails when the couple already has two members', async () => {
    await seedInvite(CODE, { coupleId: C1, createdBy: ALICE.uid }, C1);
    await assertFails(joinBatch(await as(EVE), EVE, C1).commit());
  });

  it('fails when you are already a member, or when the invite names someone else as the redeemer', async () => {
    await seedInvite();
    await assertFails(joinBatch(await as(CAROL), CAROL).commit());
    const db = await as(EVE);
    const batch = writeBatch(db);
    batch.update(doc(db, 'couples', C3), { members: arrayUnion(EVE.uid), joinCode: CODE });
    batch.update(doc(db, 'invites', CODE), { used: true, usedBy: 'someone-else', usedAt: NOW() });
    batch.set(doc(db, 'users', EVE.uid), { uid: EVE.uid, email: EVE.email, coupleId: C3 }, { merge: true });
    await assertFails(batch.commit());
  });

  it('cannot smuggle extra changes into the join', async () => {
    await seedInvite();
    const db = await as(EVE);
    const batch = writeBatch(db);
    batch.update(doc(db, 'couples', C3), { members: arrayUnion(EVE.uid), joinCode: CODE, createdBy: EVE.uid });
    batch.update(doc(db, 'invites', CODE), { used: true, usedBy: EVE.uid, usedAt: NOW() });
    await assertFails(batch.commit());
  });

  it('cannot add two people at once', async () => {
    await seedInvite();
    const db = await as(EVE);
    const batch = writeBatch(db);
    batch.update(doc(db, 'couples', C3), { members: arrayUnion(EVE.uid, 'friend'), joinCode: CODE });
    batch.update(doc(db, 'invites', CODE), { used: true, usedBy: EVE.uid, usedAt: NOW() });
    await assertFails(batch.commit());
  });
});
