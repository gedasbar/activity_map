// Stands in for expo-crypto, which only works inside the app.
import { randomBytes } from 'node:crypto';
export const getRandomBytesAsync = async (n) => new Uint8Array(randomBytes(n));
