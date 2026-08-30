import { initializeApp } from "firebase/app";
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyDnFXziW1V93m-aC2twSxl9xesMgg0eZEc",
  authDomain: "activity-map-155d8.firebaseapp.com",
  projectId: "activity-map-155d8",
  storageBucket: "activity-map-155d8.firebasestorage.app",
  messagingSenderId: "252305791798",
  appId: "1:252305791798:web:014fa42519a74b7baab197",
  measurementId: "G-D3ZZL4TMXK"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);