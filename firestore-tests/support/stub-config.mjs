// Stands in for src/config/firebaseConfig.ts. `db` is a live binding: tests switch it to act as different users.
export let db;
export const auth = { currentUser: null };
export const actAs = (firestore) => { db = firestore; };
