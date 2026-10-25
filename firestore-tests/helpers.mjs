import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, setLogLevel } from 'firebase/firestore';
import { readFileSync } from 'node:fs';

// The SDK logs every expected denial as an error; the tests assert on them instead.
setLogLevel('silent');

export const PROJECT_ID = 'demo-activity-map';

// Fixed ids. Couple ids are 20 characters like Firestore auto ids; uids are 28 characters like Firebase Auth uids.
export const ALICE = { uid: 'alice', email: 'alice@example.com' };
export const BOB = { uid: 'bob', email: 'bob@example.com' };
export const CAROL = { uid: 'carol', email: 'carol@example.com' };
export const EVE = { uid: 'eve', email: 'eve@example.com' }; // a stranger with an account
export const C1 = 'couple-aaaaaaaaaaaaa'; // alice + bob
export const C2 = 'couple-bbbbbbbbbbbbb'; // eve alone
export const C3 = 'couple-ccccccccccccc'; // carol alone (can be joined)

export const PHOTO = 'https://res.cloudinary.com/jpxtr4kd/image/upload/v1/test.jpg';

export const NOW = () => Date.now();

export const validCity = (coupleId = C1, over = {}) => ({
  coupleId, cityId: 'osm_123', name: 'Vilnius, Lietuva', latitude: 54.68, longitude: 25.27, unlockedAt: NOW(), ...over,
});
export const validPlace = (coupleId = C1, over = {}) => ({
  coupleId, cityId: 'osm_123', placeId: 98765, name: 'Cafe', fullName: 'Cafe, Vilnius', lat: '54.68', lon: '25.27', addedAt: NOW(), ...over,
});
export const validLog = (coupleId = C1, by = ALICE.uid, over = {}) => ({
  coupleId, cityId: 'osm_123', placeId: 98765, notes: 'Lovely', dateVisited: NOW(), photoUrls: [PHOTO], createdBy: by, ...over,
});

let env;
export const getEnv = async () => {
  env ??= await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(process.env.RULES_FILE ?? new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
  return env;
};

export const stop = async () => { await env?.cleanup(); env = undefined; };

// A Firestore instance acting as a signed-in user, or as nobody.
export const as = async (user) => (await getEnv()).authenticatedContext(user.uid, { email: user.email }).firestore();
export const anon = async () => (await getEnv()).unauthenticatedContext().firestore();

// Writes that bypass the rules, to set up the state a test starts from.
export const seed = async (fn) => (await getEnv()).withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore()));

export const reset = async () => (await getEnv()).clearFirestore();

// Standard starting world: alice and bob are a couple (C1), eve is alone (C2), carol is alone (C3).
export const seedWorld = async () => seed(async (db) => {
  const t = NOW();
  await setDoc(doc(db, 'couples', C1), { members: [ALICE.uid, BOB.uid], createdAt: t, createdBy: ALICE.uid });
  await setDoc(doc(db, 'couples', C2), { members: [EVE.uid], createdAt: t, createdBy: EVE.uid });
  await setDoc(doc(db, 'couples', C3), { members: [CAROL.uid], createdAt: t, createdBy: CAROL.uid });
  for (const [u, c] of [[ALICE, C1], [BOB, C1], [EVE, C2], [CAROL, C3]]) {
    await setDoc(doc(db, 'users', u.uid), { uid: u.uid, email: u.email, coupleId: c });
  }
});
