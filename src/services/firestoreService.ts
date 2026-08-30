import { addDoc, collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { db } from '../config/firebaseConfig';
import { UserProfile, VisitedLog } from '../models/types';

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

export const linkCoupleAccounts = async (myUid: string, sharedCode: string) => {
  const myUserRef = doc(db, 'users', myUid);
  
  // setDoc with merge: true will safely update the field if the document exists, 
  // or create the document from scratch if it is missing.
  await setDoc(myUserRef, {
    coupleId: sharedCode
  }, { merge: true });
};

// 4. Save a new memory log to the database
export const saveMemoryLog = async (log: Omit<VisitedLog, 'id'>) => {
  const logsRef = collection(db, 'visited_logs');
  await addDoc(logsRef, log);
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