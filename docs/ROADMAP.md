# Roadmap: fixes and upgrades

Ordered so each phase leaves the app working. Nothing here is done yet. Phase 0 is the only thing needed to
get the app usable again; Phases 1 to 2 are the security work.

## Decisions needed before starting

| # | Question | Recommendation |
| --- | --- | --- |
| 1 | Can the Firebase project be on the Blaze (pay-as-you-go) plan? Cloud Functions need it. The free tier covers a 2-person app, but a card is required. | Yes. It enables signed uploads and a safe invite flow. Without it, use the rules-only fallbacks marked below. |
| 2 | Keep Cloudinary for photos, or move to Firebase Storage? | Move to Firebase Storage: one vendor, and the rules can use the same couple membership check. Cloudinary only if you want its image transforms. |
| 3 | Is the app only for one couple, or could others sign up? | Plan assumes any number of couples (the safe default). |
| 4 | Do you need the existing data kept? | Assumed yes, so there is a migration step. |
| 5 | Targets: Android, iOS, web? | Assumed Android and iOS. Web is dropped from the docs and config. |

## Phase 0: Get it working again (about 1 hour)

1. Capture the real error (Metro log or screenshot). Confirm or rule out the Firestore permission hypothesis in
   [KNOWN_ISSUES.md](KNOWN_ISSUES.md).
2. Firebase console: check the Firestore rules and expiry date. Publish `firestore.rules` as an interim fix
   (it only requires sign-in, so it is insecure but functional).
3. Add `firebase.json` and `.firebaserc` so rules are deployed from the repo (`firebase deploy --only firestore:rules`)
   and never edited by hand in the console.
4. Make search failures visible: show "search unavailable, try again" for non-2xx responses and network errors
   instead of silently showing an empty list.
5. Commit the pending SDK 58 upgrade on its own branch. Run it on a real device and fix runtime errors
   (reanimated, worklets, gesture-handler 3, screens).

Done when: you can search, add a city, add a place and save a memory on a phone.

## Phase 1: Security foundations

### 1.1 Real couple model (replaces "coupleId = someone's uid")

Today anyone who learns a uid can read or write that couple's data, and nothing validates links.

New data shape:

- `couples/{coupleId}`: `{ members: [uid, ...] (max 2), createdAt }`. `coupleId` is a random Firestore id, not a uid.
- `users/{uid}`: `{ email, coupleId }`. Written only by the owner, and `coupleId` can only be set through the
  join flow (below).
- `invites/{code}`: `{ coupleId, createdBy, expiresAt, usedBy? }`. Random 128-bit code, expires in about 24 h,
  single use.

Join flow (recommended, needs Blaze): a callable Cloud Function `joinCouple(code)` validates the invite inside a
transaction, adds the caller to `members`, sets their `users/{uid}.coupleId`, and marks the invite used. Clients
cannot write `members` or `coupleId` directly.

Rules-only fallback (no Functions): the invite doc is readable by `get` only (no list). The joiner updates
`couples/{id}` through a rule that allows exactly one change: appending their own uid to a 1-member list, only
while a matching unexpired invite exists. Weaker, harder to test, but works on the free plan.

UI: "Create invite" shows the code and a share button. "Join" takes the code. Show a clear error for expired
or used codes. Show who is in the couple, with an option to leave. Skipping becomes "start solo", which creates
a couple with one member. The partner can join later.

### 1.2 Firestore rules

- Default deny. Every rule requires `request.auth != null`.
- Data collections (`unlocked_cities`, `saved_places`, `visited_logs`): allow read, update and delete only if
  the caller is in `couples/{resource.data.coupleId}.members`. Allow create only if the caller is a member of
  `request.resource.data.coupleId`.
- `users/{uid}`: read and write own document only. `coupleId` cannot be changed by the client.
- Validate fields on write: types, string length caps (notes <= 2000, names <= 200), `photoUrls` size and
  host, rating 0 to 5 in steps of 0.5, lat and lon ranges, `createdBy == request.auth.uid`, immutable
  `coupleId`, `cityId`, `createdBy` on update.
- Cap array sizes and block unknown fields (`request.resource.data.keys().hasOnly([...])`).
- Rules unit tests with `@firebase/rules-unit-testing` and the Firestore emulator: another couple's user must be
  denied on every operation; a member must be allowed.

### 1.3 Account and abuse protection

- Turn on **Firebase App Check** (Play Integrity on Android, App Attest on iOS), then enforce it for Firestore,
  Storage, and Functions. This blocks scripts that use the public API key.
- Restrict the Firebase API key in Google Cloud Console (Android package and SHA-1, iOS bundle id, API
  allowlist).
- Email verification required before linking; password reset on the login screen; sensible password rules;
  rate-limit messages from Firebase Auth surfaced nicely. Consider disabling open sign-up after both of you
  exist (or require an invite code to register).
- Optional: Google and Apple sign-in instead of passwords.
- Firebase budget alert, plus App Check quotas, so a leaked key can't run up a bill.

### 1.4 Photos

- Stop using an unsigned Cloudinary preset. Preferred: Firebase Storage with rules that tie
  `couples/{coupleId}/photos/{file}` to couple membership, a size limit (for example 10 MB) and an
  `image/*` content-type check. Store the storage path, not just a URL. Use `getDownloadURL` or short-lived
  URLs.
- If staying on Cloudinary: signed uploads via a callable Function (authenticated, per-user limits), and
  delete the asset when a memory or place is deleted.
- Strip location EXIF before upload (keep only the capture date) so photos never leak the home address.
- Delete photos when memories, places or cities are deleted (today they are orphaned forever).

### 1.5 Secrets and configuration

- Move the Firebase config and Cloudinary values to `EXPO_PUBLIC_*` variables in an `.env` (git-ignored), with
  `.env.example` committed. Remember these are still public in the app bundle; the real protection is rules and
  App Check.
- Rotate the Firebase API key and the Cloudinary preset after the above is in place, because the old values are in
  git history. Remove `.idea/` from the repo.
- Add `npm audit` and a secret scanner (gitleaks) to CI.

### 1.6 Migrate existing data (one-off)

A Node admin script run locally with a service account (never committed):

1. For each distinct `coupleId` among existing docs, create a `couples/{newId}` doc with the right members (the
   two uids).
2. Rewrite `coupleId` on every document in the three data collections and on both `users` docs.
3. Dry-run mode and a Firestore export beforehand. Keep a rollback copy.

## Phase 2: Data integrity and correctness

- Use `writeBatch` or transactions for multi-document deletes (city → places → memories) and add pagination or
  `limit` to unbounded queries. Cascade photo deletes.
- Deduplicate cities by a stable key (OSM id) in a deterministic document id (`cities/{coupleId}_{osmId}`) so
  duplicates are impossible, not just hidden.
- Store `lat` and `lon` as numbers; migrate old rows. Add `placeId` to the `VisitedLog` type; replace the many
  `any` types with real interfaces (`City`, `SavedPlace`, `Memory`) shared by service and UI.
- Photo upload: parallel uploads with progress, per-file retry, and partial-failure reporting; keep the note when
  there are several photos (attach it to the first, or add a text-only memory).
- Fix `LinkAccountScreen` writing to a placeholder uid (`'Loading...'`).
- Use `onSnapshot` listeners so the partner's changes appear live, not only after a reload.
- Offline: enable Firestore persistence and show a clear offline state.

## Phase 3: Search and maps

- Proxy geocoding through one small function (or use a keyed provider such as Mapbox, Geoapify or Photon) so the
  app is not coupled to Nominatim's usage policy; send a proper identifying User-Agent; cache results; debounce at
  >= 1 s or search on submit.
- Better query building: structured search (`q=<place>&viewbox=<city bounds>&bounded=1`) instead of
  `"text, City, Country"`, which fails for some inputs (`cafe, Vilnius, Lithuania` returned nothing).
- Configure a Google Maps API key (restricted to the app) in `app.json` for Android builds, or switch to the
  Apple/Google default per platform on purpose. Verify `onPoiClick` behaviour on both.
- Show distinct error and empty states; handle a user who is offline.

## Phase 4: Code health

- Split `src/app/index.tsx` into: `useAuth`, `useCouple`, `useCities`, `usePlaceSearch` hooks; `MapScreen`,
  `AddCitySheet`, `MenuSheet`, `Gallery`, `FullScreenViewer` components; a `theme.ts` for colors and spacing.
  Format with Prettier (one statement per line).
- Keep all Firestore access in a typed service layer. Remove Lithuanian/English comment mix (pick English).
- Adopt expo-router properly: separate routes for login, link, map, with `Redirect` auth guards instead of
  one component that swaps screens. Use the `@/` alias consistently once it works in the build.
- Remove unused dependencies and the unused `storage` export; replace `Alert.alert` error messages with a
  consistent toast/error pattern.
- Dark-theme the login and link screens to match the app.
- Tests: Jest + `jest-expo` for the pure helpers (EXIF date parsing, name normalisation, thumbnail URLs) and
  service functions with a mocked Firestore; emulator-based rules tests from Phase 1; one end-to-end smoke test
  (Maestro or Detox) for login → add city → add place → add memory.
- ESLint with `eslint-config-expo` and a strict `tsc` step. Remove `@ts-ignore` by importing
  `getReactNativePersistence` from the correct entry (`firebase/auth` RN build) with a type shim.

## Phase 5: Release and operations

- EAS Build profiles (development, preview, production), app identifiers in `app.json` (`ios.bundleIdentifier`,
  `android.package`), version policy, OTA updates with `expo-updates`.
- GitHub Actions: install, `tsc`, lint, tests, rules tests on every PR; `npm audit`.
- Crash and error reporting (Sentry or Firebase Crashlytics), with no personal data in reports.
- Firestore scheduled backups and a documented restore procedure.
- Privacy: short privacy policy, an in-app "delete my account and data" action (needed by the app stores), and a
  data export option.

## Phase 6: Product upgrades (optional)

- Photo captions, editing a memory, and editing place names; place categories and filters.
- Search and filter your places; a list view; "places I want to go" (wishlist) as well as visited.
- Country-level stats and a visited-countries view; trip timeline.
- Map clustering for many markers; custom pin icons by category/rating.
- Push notifications for "On This Day" and when your partner adds something.
- Shared albums and export to PDF or photo book.
- Accessibility pass (labels, contrast, dynamic type) and localisation (English and Lithuanian).

## Suggested order and effort

| Phase | Effort | Why this order |
| --- | --- | --- |
| 0 | hours | Restores the app; unblocks everything else |
| 1.2 to 1.3 with 1.1 | 2 to 3 days | Closes the open-database hole; do rules, couples model and migration together |
| 1.4 to 1.6 | 1 to 2 days | Photo hardening and secret rotation, once rules are tight |
| 2 and 3 | 2 to 4 days | Correctness and reliable search |
| 4 | 3 to 5 days | Easier maintenance; do with tests in place |
| 5 | 1 to 2 days | Shipping and operations |
| 6 | open | Features after the base is solid |

Each phase can be a separate branch and PR. For security work, test the rules in the emulator before
deploying, and migrate data only after a backup.
