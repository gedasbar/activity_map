# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v58.0.0/ before writing any code.

# Activity Map: guide for AI agents

Activity Map is a shared "places we've been" app for a couple. You add cities to a map, save places inside
each city (found by search, by tapping a map POI, or by long-pressing the map), then attach dated notes and
photos to each place and rate it. Both partners see the same data.

Stack: Expo SDK 58, React Native 0.88, React 19.3, expo-router, TypeScript (strict), Firebase Auth and
Firestore, react-native-maps, Cloudinary for photos, OpenStreetMap Nominatim for geocoding.

There is no backend of our own, no test suite and no CI. The UI strings are English, but some code comments
(mostly `firestoreService.ts`) are in Lithuanian.

## Commands

```bash
npm install
npx expo start        # or: npm run android | ios | web
npx tsc --noEmit      # type check; currently passes with 0 errors
npx expo lint
npx expo-doctor       # currently 20/20 checks pass
```

`react-native-maps` and `@gorhom/bottom-sheet` need a dev build or Expo Go on a device or emulator. The web
target is not a supported way to run this app.

## Layout

| Path | What it is |
| --- | --- |
| `src/app/_layout.tsx` | expo-router root: a headerless `Stack` |
| `src/app/index.tsx` | The whole app screen (about 730 lines): auth gate, map, add-city modal, place search, settings sheet, gallery |
| `src/components/CityDetailSheet.tsx` | Per-city sheet: saved places, ratings, per-place memories, photo upload, date editing |
| `src/components/LoginScreen.tsx` | Email and password sign in or sign up |
| `src/components/LinkAccountScreen.tsx` | Enter a partner code, or "skip" to link to yourself |
| `src/services/firestoreService.ts` | Every Firestore read and write; the only file that talks to the database |
| `src/config/firebaseConfig.ts` | Firebase init; exports `auth`, `db`, `storage` |
| `src/models/types.ts` | `UserProfile` and `VisitedLog` types |
| `firestore.rules` | Security rules (not tracked in git yet; must be deployed by hand) |
| `docs/` | Architecture, data model, known issues |

Imports use relative paths. `tsconfig.json` defines an `@/*` alias, but a commit ("use relative imports ... to
resolve module alias error") moved off it. Keep using relative imports.

## How it works in one paragraph

On launch `index.tsx` listens to `onAuthStateChanged`. No user shows `LoginScreen`. A user whose profile has
no `coupleId` sees `LinkAccountScreen`. Otherwise the map loads. The `coupleId` is the partner's Firebase uid
(or your own uid if you skipped). Every document in every collection carries a `coupleId`, and every query
filters on it, so that string is the only thing that "shares" data between two accounts. Details are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/DATA_MODEL.md](docs/DATA_MODEL.md).

## Conventions and gotchas

- All Firestore access goes through `firestoreService.ts`. Add new queries there, not inline in components.
- Queries only use `where(... '==' ...)` and sort in JS afterwards, to avoid composite indexes. Keep it that way
  unless you also create the indexes.
- Firestore rejects `undefined` field values. Build documents explicitly.
- A place's `placeId` is a string (`poi_*` or `custom_*`) or an OSM numeric `place_id`. Always compare it as a
  string. `saved_places.id` (the Firestore doc id) and `saved_places.placeId` (the OSM or custom id) are
  different things. Memories link to the `placeId`.
- Most data is typed `any`. `VisitedLog` in `models/types.ts` is missing `placeId`, which the code writes and reads.
- Styling is inline `StyleSheet` objects in each file. The look is dark glass (`expo-blur` `BlurView`,
  `tint="dark"`). Match it. `LoginScreen` and `LinkAccountScreen` are still light-themed and unstyled to match.
- `index.tsx` is dense, with many statements per line. Keep edits local rather than reformatting the file,
  because reformatting makes the diff unreadable.
- Line endings: the working tree is CRLF on Windows. `git diff` shows large whitespace noise on some files.
  Use `git diff -w --ignore-cr-at-eol`.
- `react-native-reanimated` and `react-native-worklets` need the Babel plugin that `babel-preset-expo` adds
  automatically. There is no `babel.config.js`. Don't add one without a reason.
- `experiments.reactCompiler` is on in `app.json`. Avoid mutating props or state in render.

## Secrets and external services

- The Firebase web config in `firebaseConfig.ts` is committed. Firebase web keys are not secret on their own;
  the Firestore rules are the real protection. See [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md).
- Photos upload straight from the device to Cloudinary (cloud `jpxtr4kd`, unsigned preset `pind_map`) from
  `CityDetailSheet.tsx`. Firebase Storage is initialised but unused.
- Place and city search call `https://nominatim.openstreetmap.org/search` directly with a custom
  `User-Agent`. Nominatim's usage policy allows about 1 request per second and requires an identifying
  User-Agent. Search is debounced at 400 ms.
- Do not add real credentials, `.env` files or new API keys to the repo.

## Working agreements

- Check the Expo SDK 58 docs before touching anything Expo-related. Many APIs changed.
- Read [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) before debugging. The current failures are probably listed there.
- Verify changes with `npx tsc --noEmit`. There are no tests, so for UI changes say plainly that you could not run the app.
- Don't deploy Firestore rules or touch the Firebase console from here. Tell the user what to change.
