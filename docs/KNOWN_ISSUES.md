# Known issues and debugging notes

Written from a read-only review (no code was changed, and the app was not run on a device).
Items are marked **verified** (I ran something to confirm) or **hypothesis**.

## Status update (2026-10-25)

Fixed since this was written: city and place search (resilient, with a fallback), the gallery and menu sheet crashes and
scrolling, account linking (invite codes instead of pasting a uid), and the open database rules (strict rules written
and tested; **they take effect only when you publish them**, see [SECURITY_ROLLOUT.md](SECURITY_ROLLOUT.md)). The notes
below are kept for history.

## Reported symptom: "can't search for locations, it gives me an error"

The exact error text hasn't been captured yet, so the cause is not confirmed. What was checked:

- **Verified:** Nominatim itself is up and answers the exact URL shapes the app builds, with the app's
  `User-Agent`. City search (`Kaunas`) and place search (`Cathedral, Vilnius, Lietuva`) both return results.
  So the HTTP search is probably not the root problem.
- **Verified:** `npx tsc --noEmit` and `npx expo-doctor` are clean, so it is not a type error or an obvious SDK
  version mismatch.
- **Verified:** the search code swallows failures. In `handleCitySearch` and `handleOSMSearch`, a non-2xx
  response (for example a 403 or 429 from Nominatim) just `return`s and shows "No cities found" or nothing.
  Network and JSON errors only go to `console.error`. The user never sees why. So "search gives an error" is
  more likely to be an error from a *later* step or a red-screen crash than the fetch itself.

Most likely causes, in order:

1. **Firestore permission errors (hypothesis, most likely).** Nearly every action touches Firestore: loading the
   map, adding a city, saving a place (`savePlace`), and saving a memory. If the project's Firestore rules are
   still the default "test mode", they expire after 30 days, after which every read and write fails with
   `permission-denied` ("Missing or insufficient permissions"). The uncommitted changes in the working tree
   (new `firestore.rules`, new try/catch and a "Firestore Permission Error" alert in `index.tsx`) show that
   someone was already chasing this. The rules file in the repo is **not deployed** by anything. Fix: paste/publish
   the rules in Firebase console → Firestore → Rules, or add `firebase.json` and run `firebase deploy --only firestore:rules`.
   Check the Firebase console for the project `activity-map-155d8` and the rules' expiry date.
2. **Nominatim blocking or throttling the app (hypothesis).** The app sends `User-Agent: ActivityMapApp/1.0`, a
   generic value with no contact. Nominatim's policy asks for an identifying UA or Referer, and it limits
   clients to about 1 request per second. Heavy testing, or a shared IP, can return 403/429, which the app
   hides (see above). Use a UA with a contact e-mail, or switch to a geocoder with an API key.
3. **Platform differences (hypothesis).** On web, browsers refuse to let `fetch` set `User-Agent`, and CORS may apply.
   On native, `onPoiClick` only works with the provider's POI layer (Apple Maps, or Google Maps with a key).
   No Google Maps API key is configured in `app.json`, so Android needs one for `react-native-maps` in a build
   (Expo Go ships with one).
4. **Fresh SDK 57 → 58 upgrade (hypothesis).** The working tree bumps nearly every native dependency (RN 0.86 → 0.88,
   reanimated 4.5 → 4.7, gesture-handler 2.32 → 3.3, screens 4.26 → 4.30, and so on) and is not committed.
   Runtime errors like "Reanimated/worklets mismatch" are possible and wouldn't be caught by `tsc`. If the app
   is on a phone with Expo Go, the Expo Go version must support SDK 58.
5. **Auth persistence race (low).** `initializeAuth` in `firebaseConfig.ts` is wrapped in a `catch` that falls
   back to `getAuth`. If that fallback happens, the session isn't persisted, so users get signed out between launches.

**To pin it down, we need:** the exact error text or screenshot, which screen (Add City search vs. place
search vs. saving), and the platform (Android, iOS, web, Expo Go or dev build). Running `npx expo start` and
copying the Metro terminal output at the moment of the failure is the quickest way.

## Other bugs and risks found while reading

Behaviour:

- **Account linking can silently not link two people.** Both users must end up with the same `coupleId`; see
  [ARCHITECTURE.md](ARCHITECTURE.md#account-linking-couple-model). Mutual code exchange makes the data
  invisible to each other. The code isn't validated, so a typo "links" you to an empty space.
- `LinkAccountScreen` shows `auth.currentUser?.uid || 'Loading...'` and passes that string to `linkCoupleAccounts`
  as the uid. If it were still `'Loading...'` it would write to `users/Loading...`.
- `handleConnectPartner` in `index.tsx` changes `coupleId` but keeps the old data in the previous space. Nothing
  is migrated.
- Adding a city twice is only prevented in the search results (by name). Two devices can still create duplicates;
  `loadCitiesAndPlaces` dedupes on `cityId` when displaying, but `deleteUnlockedCity` removes them all.
- Deleting a place deletes its memories, but the photos stay in Cloudinary.
- Memories with several photos lose the note text (by design, commit "removed note input for multiple photos").
- `handleSaveMemory` uploads photos sequentially. A failure halfway leaves some memories saved and the
  rest not, with a generic "Failed to save the memories" alert.
- `selectedCity.name` is `"City, Country"` and is appended to place searches. This works but can give odd
  results for common names. Nominatim returns nothing for some free-text mixes (for example `cafe, Vilnius, Lithuania`
  returned `[]`; `cafe Vilnius` worked), so category-style searches are unreliable.
- `ZOOM_THRESHOLD = 0.15`: place markers only show when zoomed in past that latitude delta.

Security and cost:

- **Firestore rules allow any authenticated user to read and write everything**, including other couples' data, if
  they know or guess a `coupleId` (a uid). Anyone can sign up with an e-mail. See the DATA_MODEL doc.
- Firebase web config (including API key) and the Cloudinary preset are committed. The Firebase key is normal for web
  apps, but restrict it in Google Cloud Console. An unsigned Cloudinary preset lets anyone who finds it upload
  to your account; restrict the preset's formats and size in Cloudinary.
- No email verification and no password reset on `LoginScreen`.

Code quality:

- `index.tsx` is one 730-line component with dense one-line statements; it is hard to review and edit.
- Many `any` types; `VisitedLog` lacks `placeId`.
- `createDynamicSwipe` pan responders are built once in `useMemo(..., [])` with empty deps, and the Settings and Add City
  sheets also have `useEffect`s keyed on a boolean. It works but is fragile.
- Unused style entries and unused dependencies (see ARCHITECTURE.md). `firebase/storage` is initialised but never used.
- `README.md` was the Expo template text and mentioned a `reset-project` script that does not exist.
- The `.idea/` folder is committed.

## Working tree state when this was written

Uncommitted: `AGENTS.md`, `app.json`, `package.json`, `package-lock.json`, `tsconfig.json`, `src/app/index.tsx`,
`src/components/CityDetailSheet.tsx`, `src/config/firebaseConfig.ts`, and an untracked `firestore.rules`.
Roughly: the SDK 57 → 58 upgrade, try/catch around Firestore calls, auth persistence, and CRLF noise
(`git diff -w --ignore-cr-at-eol` shows the real changes, about 130 lines in `src`).
`HEAD` is `7cf5f70` (merge of PR #10).
