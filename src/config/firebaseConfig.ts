import { initializeApp, getApps, getApp } from "firebase/app";
// @ts-ignore: getReactNativePersistence is exported in the React Native entry point of firebase/auth
import { initializeAuth, getReactNativePersistence, getAuth } from 'firebase/auth';
import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
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

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth = (() => {
  if (Platform.OS === 'web') {
    return getAuth(app);
  }
  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(ReactNativeAsyncStorage),
    });
  } catch {
    return getAuth(app);
  }
})();

export const db = getFirestore(app);
export const storage = getStorage(app);