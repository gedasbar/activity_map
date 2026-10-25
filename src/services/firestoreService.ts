import * as Crypto from 'expo-crypto';
import { addDoc, arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../config/firebaseConfig';
import type { Couple, CoupleMember, Invite, UserProfile, VisitedLog } from '../models/types';
import { formatInviteCode, generateInviteCode, INVITE_CODE_LENGTH, normalizeInviteCode } from './inviteCode';

// 1. Creates a database entry for a new user
export const createUserDocument = async (uid: string, email: string) => {
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    const newUser: UserProfile = {
      uid,
      email,
      coupleId: null, // Null until they link accounts
    };
    await setDoc(userRef, newUser);
  }
};

// 2. Fetches the current user's profile
export const getUserProfile = async (uid: string): Promise<UserProfile | null> => {
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);
  
  if (userSnap.exists()) {
    return userSnap.data() as UserProfile;
  }
  return null;
};

// --- COUPLES AND INVITES ---
// A couple is a couples/{coupleId} document listing its members. Every other document carries that coupleId.
// Older couples use a user's uid as the id and have no couples document until ensureCouple creates one.

export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export class InviteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InviteError';
  }
}

// Creates the couples document for an older couple (id = a uid) if it does not exist yet.
export const ensureCouple = async (uid: string, coupleId: string) => {
  const coupleRef = doc(db, 'couples', coupleId);
  if ((await getDoc(coupleRef)).exists()) return;

  const membersSnap = await getDocs(query(collection(db, 'users'), where('coupleId', '==', coupleId)));
  const members = Array.from(new Set([uid, ...membersSnap.docs.map(d => d.id)]));
  const couple: Couple = { members, createdAt: Date.now(), createdBy: uid };
  await setDoc(coupleRef, couple);
};

// Starts a new couple with only this user in it. They can invite their partner later.
export const createSoloCouple = async (uid: string, email: string): Promise<string> => {
  const coupleRef = doc(collection(db, 'couples'));
  const couple: Couple = { members: [uid], createdAt: Date.now(), createdBy: uid };
  const batch = writeBatch(db);
  batch.set(coupleRef, couple);
  batch.set(doc(db, 'users', uid), { uid, email, coupleId: coupleRef.id }, { merge: true });
  await batch.commit();
  return coupleRef.id;
};

// Creates a single-use invite for the couple. The partner types the code in LinkAccountScreen.
export const createInvite = async (uid: string, coupleId: string): Promise<{ code: string; displayCode: string; expiresAt: number }> => {
  await ensureCouple(uid, coupleId);

  for (let attempt = 0; attempt < 3; attempt++) {
    const code = await generateInviteCode(Crypto.getRandomBytesAsync);
    const inviteRef = doc(db, 'invites', code);
    if ((await getDoc(inviteRef)).exists()) continue;

    const now = Date.now();
    const invite: Invite = { coupleId, createdBy: uid, createdAt: now, expiresAt: now + INVITE_TTL_MS, used: false };
    await setDoc(inviteRef, invite);
    return { code, displayCode: formatInviteCode(code), expiresAt: invite.expiresAt };
  }
  throw new Error('Could not create an invite. Please try again.');
};

// Redeems an invite: adds the user to the couple, marks the invite used and points the user's profile at the
// couple. One atomic batch, so a failure leaves nothing half-done. Returns the coupleId.
export const joinWithInvite = async (uid: string, email: string, rawCode: string): Promise<string> => {
  const code = normalizeInviteCode(rawCode);
  if (code.length !== INVITE_CODE_LENGTH) throw new InviteError('That code does not look right. It has 10 letters and numbers.');

  const inviteRef = doc(db, 'invites', code);
  const inviteSnap = await getDoc(inviteRef);
  if (!inviteSnap.exists()) throw new InviteError('Invalid code. Check it and try again.');

  const invite = inviteSnap.data() as Invite;
  if (invite.used) throw new InviteError('This code has already been used. Ask your partner for a new one.');
  if (invite.expiresAt < Date.now()) throw new InviteError('This code has expired. Ask your partner for a new one.');
  if (invite.createdBy === uid) throw new InviteError('You created this code. Send it to your partner instead.');

  const now = Date.now();
  const batch = writeBatch(db);
  batch.update(doc(db, 'couples', invite.coupleId), { members: arrayUnion(uid), joinCode: code });
  batch.update(inviteRef, { used: true, usedBy: uid, usedAt: now });
  batch.set(doc(db, 'users', uid), { uid, email, coupleId: invite.coupleId }, { merge: true });
  await batch.commit();
  return invite.coupleId;
};

// Members of the couple with their e-mail addresses (older profiles may not have one).
export const getCoupleMembers = async (uid: string, coupleId: string): Promise<CoupleMember[]> => {
  const coupleSnap = await getDoc(doc(db, 'couples', coupleId));
  const memberIds: string[] = coupleSnap.exists()
    ? (coupleSnap.data() as Couple).members
    : (await getDocs(query(collection(db, 'users'), where('coupleId', '==', coupleId)))).docs.map(d => d.id);

  return Promise.all(Array.from(new Set([uid, ...memberIds])).map(async (memberId) => {
    const profile = await getUserProfile(memberId);
    return { uid: memberId, email: profile?.email ?? null, isMe: memberId === uid };
  }));
};

// 4. Save a new memory log to the database
export const saveMemoryLog = async (log: Omit<VisitedLog, 'id'>) => {
  const logsRef = collection(db, 'visited_logs');
  await addDoc(logsRef, log);
};

// 4b. Delete a memory log
export const deleteMemoryLog = async (logId: string) => {
  const logRef = doc(db, 'visited_logs', logId);
  await deleteDoc(logRef);
};

// 5. Fetch all memories for a specific city and couple
export const getCityMemories = async (coupleId: string, cityId: string): Promise<VisitedLog[]> => {
  const logsRef = collection(db, 'visited_logs');
  const q = query(
    logsRef,
    where('coupleId', '==', coupleId),
    where('cityId', '==', cityId)
  );
  
  const snapshot = await getDocs(q);
  const logs: VisitedLog[] = [];
  
  snapshot.forEach(doc => {
    logs.push({ id: doc.id, ...doc.data() } as VisitedLog);
  });
  
  // Sort locally by newest first to avoid needing complex Firestore indexes right now
  return logs.sort((a, b) => b.dateVisited - a.dateVisited);
};
// --- NAUJOS FUNKCIJOS MIESTŲ ATRAKINIMUI ---

// Išsaugo naujai pridėtą miestą duomenų bazėje
export const unlockCity = async (coupleId: string, city: any) => {
  const unlockedRef = collection(db, 'unlocked_cities');
  await addDoc(unlockedRef, {
    coupleId: coupleId,
    cityId: city.id,
    name: city.name,
    latitude: city.latitude,
    longitude: city.longitude,
    unlockedAt: Date.now()
  });
};

// Paima visus jūsų poros pridėtus miestus
export const getUnlockedCities = async (coupleId: string): Promise<any[]> => {
  const unlockedRef = collection(db, 'unlocked_cities');
  const q = query(unlockedRef, where('coupleId', '==', coupleId));
  const snapshot = await getDocs(q);
  
  const cities: any[] = [];
  snapshot.forEach(doc => {
    cities.push({ docId: doc.id, ...doc.data() });
  });
  return cities;
};

// Ištrina atrakintą miestą ir visus jo įrašus bei vietas
export const deleteUnlockedCity = async (coupleId: string, cityId: string) => {
  const unlockedRef = collection(db, 'unlocked_cities');
  const qCity = query(unlockedRef, where('coupleId', '==', coupleId), where('cityId', '==', cityId));
  const citySnap = await getDocs(qCity);
  const deleteCityPromises = citySnap.docs.map(d => deleteDoc(d.ref));
  await Promise.all(deleteCityPromises);

  const placesRef = collection(db, 'saved_places');
  const qPlaces = query(placesRef, where('coupleId', '==', coupleId), where('cityId', '==', cityId));
  const placesSnap = await getDocs(qPlaces);
  const deletePlacePromises = placesSnap.docs.map(d => deleteDoc(d.ref));
  await Promise.all(deletePlacePromises);

  const logsRef = collection(db, 'visited_logs');
  const qLogs = query(logsRef, where('coupleId', '==', coupleId), where('cityId', '==', cityId));
  const logsSnap = await getDocs(qLogs);
  const deleteLogPromises = logsSnap.docs.map(d => deleteDoc(d.ref));
  await Promise.all(deleteLogPromises);
};
// --- KONKREČIŲ VIETŲ (PLACES) FUNKCIJOS ---

// 1. Išsaugo naują konkrečią vietą mieste
export const savePlace = async (coupleId: string, cityId: string, placeData: any) => {
  const placesRef = collection(db, 'saved_places');
  await addDoc(placesRef, {
    coupleId,
    cityId,
    placeId: placeData.place_id, // OSM unikalus ID
    name: placeData.name || placeData.display_name.split(',')[0], // Paimame trumpą pavadinimą
    fullName: placeData.display_name,
    lat: placeData.lat,
    lon: placeData.lon,
    addedAt: Date.now()
  });
};

// 2. Gauna visas jūsų pridėtas vietas tam tikrame mieste
export const getCityPlaces = async (coupleId: string, cityId: string): Promise<any[]> => {
  const placesRef = collection(db, 'saved_places');
  const q = query(
    placesRef,
    where('coupleId', '==', coupleId),
    where('cityId', '==', cityId)
  );
  
  const snapshot = await getDocs(q);
  const places: any[] = [];
  snapshot.forEach(doc => {
    places.push({ id: doc.id, ...doc.data() });
  });
  
  return places.sort((a, b) => b.addedAt - a.addedAt);
};

// 2b. Ištrina išsaugotą vietą ir jos atsiminimus
export const deleteSavedPlace = async (placeDocId: string, coupleId?: string, placeId?: string) => {
  const placeRef = doc(db, 'saved_places', placeDocId);
  await deleteDoc(placeRef);

  if (coupleId && placeId) {
    const logsRef = collection(db, 'visited_logs');
    const q = query(
      logsRef,
      where('coupleId', '==', coupleId),
      where('placeId', '==', placeId)
    );
    const snapshot = await getDocs(q);
    const deletePromises = snapshot.docs.map(d => deleteDoc(d.ref));
    await Promise.all(deletePromises);
  }
};

// 3. Gauna atsiminimus konkrečiai vietai (vietoj viso miesto)
export const getPlaceMemories = async (coupleId: string, placeId: string): Promise<any[]> => {
  const logsRef = collection(db, 'visited_logs');
  const q = query(
    logsRef,
    where('coupleId', '==', coupleId),
    where('placeId', '==', placeId) // Dabar rišame prie vietos ID
  );
  
  const snapshot = await getDocs(q);
  const logs: any[] = [];
  snapshot.forEach(doc => {
    logs.push({ id: doc.id, ...doc.data() });
  });
  
  return logs.sort((a, b) => b.dateVisited - a.dateVisited);
};
export const getAllSavedPlaces = async (coupleId: string): Promise<any[]> => {
  const placesRef = collection(db, 'saved_places');
  const q = query(placesRef, where('coupleId', '==', coupleId));
  const snapshot = await getDocs(q);
  const places: any[] = [];
  snapshot.forEach(doc => {
    places.push({ id: doc.id, ...doc.data() });
  });
  return places;
};

export const updatePlaceRating = async (placeDocId: string, rating: number) => {
  const placeRef = doc(db, 'saved_places', placeDocId);
  await updateDoc(placeRef, { rating });
};

export const getAllCoupleMemories = async (coupleId: string): Promise<any[]> => {
  const logsRef = collection(db, 'visited_logs'); // Change this if your collection name is different
  const q = query(logsRef, where('coupleId', '==', coupleId));
  const snapshot = await getDocs(q);
  const logs: any[] = [];
  snapshot.forEach(doc => {
    logs.push({ id: doc.id, ...doc.data() });
  });
  // Sort from newest to oldest
  return logs.sort((a, b) => b.dateVisited - a.dateVisited);
};

export const updateMemoryDate = async (logId: string, newDateTimestamp: number) => {
  const logRef = doc(db, 'visited_logs', logId);
  await updateDoc(logRef, { dateVisited: newDateTimestamp });
};