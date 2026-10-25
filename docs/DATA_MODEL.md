# Data model (Firestore)

Four top-level collections. All except `users` carry a `coupleId` string and are always queried by it.
There are no subcollections and no composite indexes (queries are equality-only; sorting happens in JS).

## `users/{uid}`

| Field | Type | Notes |
| --- | --- | --- |
| `uid` | string | Same as the document id |
| `email` | string | |
| `coupleId` | string or null | Null until linked. Equals a partner's uid (or your own if you skipped) |

Created in `LoginScreen.handleSignUp` via `createUserDocument`. `linkCoupleAccounts` uses `setDoc(..., { merge: true })`,
so it also creates the document if it is missing.

## `unlocked_cities/{autoId}`: a city on the map

`coupleId`, `cityId` (`"osm_<nominatim place_id>"`), `name` (`"Vilnius, Lietuva"`), `latitude`, `longitude`
(numbers), `unlockedAt` (ms).

Deleting a city (`deleteUnlockedCity`) removes the city documents plus all `saved_places` and `visited_logs`
with the same `coupleId` and `cityId`.

## `saved_places/{autoId}`: a place inside a city

| Field | Notes |
| --- | --- |
| `coupleId`, `cityId` | Links to owner and city |
| `placeId` | OSM numeric `place_id`, or the string `poi_...` or `custom_...`. Memories join on this |
| `name`, `fullName` | `fullName` is Nominatim's `display_name` |
| `lat`, `lon` | **Strings**, as Nominatim returns them; parsed with `parseFloat` when drawn |
| `addedAt` | ms |
| `rating` | Optional number, set by `updatePlaceRating` (UI allows half stars up to 5) |

## `visited_logs/{autoId}`: a memory (note and/or one photo)

| Field | Notes |
| --- | --- |
| `coupleId`, `cityId`, `placeId` | `placeId` matches `saved_places.placeId` (not the document id) |
| `notes` | string, possibly empty |
| `dateVisited` | ms. Photo EXIF date, or the chosen date |
| `photoUrls` | string[]. In practice zero or one Cloudinary `secure_url` |
| `createdBy` | uid of the author |

The TypeScript `VisitedLog` type does not list `placeId`, but the data has it.

## Cloudinary

Cloud name `jpxtr4kd`, unsigned upload preset `pind_map`. Thumbnails are produced client-side by rewriting
`/upload/` to `/upload/c_fill,w_300,h_300,q_auto/` in the URL. Photos are never deleted from Cloudinary when
a memory is removed (the app can't do that with an unsigned preset).

## Security rules

`firestore.rules` currently allows any signed-in user to read and write all four collections. Nothing
limits a user to their own `coupleId`. It is **not deployed by the repo**: there is no `firebase.json`, so the
live rules are whatever is set in the Firebase console.

## What the live database looked like (checked 2026-10-25 in the Firebase console)

- Both partners' `users` documents carry the **same `coupleId`**, and that value is the *first* partner's Firebase
  uid (not the second partner's).
- The first partner's `users` document has only `coupleId` (no `uid` or `email`): it was created by
  `linkCoupleAccounts` (merge) because the account predates `createUserDocument`. Code must not assume
  `users/{uid}.email` exists.
- `unlocked_cities` rows have `cityId` as a slug (for example `"plunge"`), not the `osm_<place_id>` form that city search
  produces today, so ids come in at least two formats.
- Almost all places were added by the partner whose sign-in currently fails; the data is stored under the other
  partner's uid, so it is not tied to the broken account.
