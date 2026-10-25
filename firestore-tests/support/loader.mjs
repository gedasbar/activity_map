// Lets Node run the app's TypeScript services unchanged: stubs the two imports that only work in the app and
// resolves the app's extensionless imports. Firebase is always resolved from this folder so the tests and the
// services share one copy of the SDK.
import { pathToFileURL } from 'node:url';

const HERE = new URL('.', import.meta.url);
const OWN_PACKAGE_JSON = new URL('../package.json', import.meta.url).href;
const isBare = (s) => !s.startsWith('.') && !s.startsWith('file:') && !s.startsWith('node:') && !s.startsWith('/') && !/^[A-Za-z]:/.test(s);

export async function resolve(specifier, context, next) {
  if (specifier === 'expo-crypto') return { url: new URL('stub-crypto.mjs', HERE).href, shortCircuit: true };
  if (specifier.endsWith('config/firebaseConfig')) return { url: new URL('stub-config.mjs', HERE).href, shortCircuit: true };
  if (context.parentURL?.includes('/src/') && isBare(specifier)) return next(specifier, { ...context, parentURL: OWN_PACKAGE_JSON });
  if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && context.parentURL?.includes('/src/')) return next(specifier + '.ts', context);
  return next(specifier, context);
}
