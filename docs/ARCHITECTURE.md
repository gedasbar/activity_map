# Architecture

## Runtime pieces

```
Phone (Expo / React Native app)
 ├─ Firebase Auth ........ email + password, session persisted in AsyncStorage
 ├─ Firestore ............ all app data (cities, places, memories, user profile)
 ├─ Cloudinary ........... photo files (unsigned upload from the device)
 └─ Nominatim (OSM) ...... geocoding for city search and place search
```

There is no server code. The security of the data rests on `firestore.rules`.

## Screen flow (`src/app/index.tsx`)

`App` is the only screen. It renders one of four states:

1. `loading` shows a spinner while auth and profile are resolved.
2. No `user` shows `LoginScreen`.
3. A user without a linked account shows `LinkAccountScreen`.
4. Otherwise it shows the main map UI.

Auth bootstrap (`useEffect` with `onAuthStateChanged`): get the user, call `getUserProfile(uid)`. If
`profile.coupleId` exists, set `myCoupleId`, then `loadCitiesAndPlaces` and `loadGallery`.

### Map modes

`mapMode` is a small state machine:

| Mode | Meaning | UI |
| --- | --- | --- |
| `default` | Browsing | Top toolbar with "+ Add City" and the menu button |
| `city_menu` | A city pin was tapped | Modal: Search and add place, View saved places, Remove city |
| `search_place` | Adding a place to `selectedCity` | Search bar and result list, then a preview bar with Save |
| `view_places` | Viewing the city's places | Modal containing `CityDetailSheet` |

`selectedCity` is set when a city pin is tapped and cleared when you go back to `default`.

### Ways to add a place (mode `search_place`)

1. **Text search.** `handleOSMSearch` debounces 400 ms, aborts the previous request, and queries Nominatim with
   `"<text>, <selectedCity.name>"`. Picking a result calls `selectSearchResult`, which sets `previewPlace` and
   zooms the map.
2. **Tap a map POI** (`onPoiClick`). It builds a `previewPlace` with `place_id = "poi_<placeId|timestamp>"` and
   asks for a name.
3. **Long-press the map.** It builds a `previewPlace` with `place_id = "custom_<timestamp>"` and asks for a name.

Methods 2 and 3 need a city selected first. Otherwise an Alert says so. `confirmAddPlace` then calls
`savePlace`, which writes to `saved_places`.

### Adding a city

"+ Add City" opens a slide-up modal. `handleCitySearch` queries Nominatim with `featuretype=settlement`, maps
results to `City { id: "osm_<place_id>", name: "<city>, <country>", latitude, longitude }` and hides cities
you already have (compared by accent-stripped name). Tapping a result calls `unlockCity`.

### Menu sheet (burger button)

A `@gorhom/bottom-sheet` with snap points 35% and 90%. At 35% it shows Stats. At 90% there are tabs:
Gallery (all photos in a 3-column grid, with a full-screen swipe viewer), Memories ("On This Day" from
previous years) and Sync (your code, the partner-code input, log out).

### Places and memories (`CityDetailSheet`)

Props: `cityId, cityName, coupleId, onClose, onPlacesUpdated`.

- `viewMode = 'city'`: list of saved places, each with a rating button and a delete button.
- `viewMode = 'place'`: memories for one place. You can add a note, pick photos with `expo-image-picker`
  (one `visited_logs` document is created per photo), choose or edit the visit date, and delete memories.
- Photo date: taken from EXIF (`DateTimeOriginal`, then `DateTimeDigitized`, then `DateTime`) when available,
  otherwise the date picker value.
- Notes are only saved with a photo when exactly one photo is selected. With several photos the note is dropped.
- Upload: `fetch` POST of `FormData` to Cloudinary; the returned `secure_url` is stored in `photoUrls`.

## Couples and invites

Data is shared through a `couples/{coupleId}` document (`members`: up to two uids). Every data document has the
`coupleId`. See [DATA_MODEL.md](DATA_MODEL.md).

- **New user, no couple:** `LinkAccountScreen` offers "Join with code" or "Start on my own". Starting alone creates
  a couple with one member (`createSoloCouple`).
- **Inviting a partner:** Menu → Sync tab → "Create invite code". `createInvite` makes a random 10-character code
  (about 50 bits, no look-alike characters, shown as `XXXXX-XXXXX`), stored as `invites/{code}` with a 24-hour
  expiry. Share it however you like.
- **Joining:** `joinWithInvite` validates the invite (exists, unused, not expired, not your own) and then writes one
  atomic batch: add the user to `couples/{id}.members` (and set `joinCode`), mark the invite used, and set the
  user's `coupleId`. A failed join writes nothing.
- **Older couples** (the `coupleId` is a user's uid) have no `couples` document. `ensureCouple` creates one, with
  every user whose profile points at that id as a member, the first time someone creates an invite.
- The old "paste your partner's uid" flow and "Skip for now" are gone: typing someone's uid silently moved you to
  their data (or to an empty space) and could not be validated.

Not enforced yet: the Firestore rules are still "any signed-in user". The batch above is shaped so that rules can
enforce it (invite valid, unused, unexpired, at most two members). That is the next step; see
[ROADMAP.md](ROADMAP.md).

## Auth setup (`firebaseConfig.ts`)

On native platforms it calls `initializeAuth` with React Native AsyncStorage persistence. It falls back to
`getAuth` if that throws (for example on hot reload when auth is already initialised). On web it uses
`getAuth`. `getReactNativePersistence` is imported under a `@ts-ignore`.

## Dependencies worth knowing

Used: `react-native-maps`, `@gorhom/bottom-sheet`, `react-native-gesture-handler`,
`react-native-reanimated`, `expo-blur`, `@expo/vector-icons` (FontAwesome), `expo-image-picker`,
`@react-native-community/datetimepicker`, `firebase`, `expo-router`.

Installed but not imported anywhere in `src`: `@expo/ui`, `expo-glass-effect`, `expo-symbols`, `expo-device`,
`expo-constants`, `expo-linking`, `expo-system-ui`, `expo-web-browser` (some are Expo template defaults or
needed by expo-router), `react-native-safe-area-context` (expo-router peer), and `expo-image` and
`firebase/storage` (only referenced in config).
