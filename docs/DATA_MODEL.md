# Data model (Firestore)

Six top-level collections: `users`, `couples`, `invites`, and three data collections (`unlocked_cities`, `saved_places`,
`visited_logs`) that each carry a `coupleId` string and are always queried by it.
There are no subcollections and no composite indexes (queries are equality-only; sorting happens in JS).

## `users/{uid}`

| Field | Type | Notes |
| --- | --- | --- |
| `uid` | string | Same as the document id |
| `email` | string | |
| `coupleId` | string or null | Null until the user joins or starts a couple. Refers to `couples/{coupleId}` |

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

## `couples/{coupleId}`: who shares a map

| Field | Notes |
| --- | --- |
| `members` | Array of uids, at most two |
| `createdAt`, `createdBy` | ms, uid |
| `joinCode` | Set when someone joins. Lets security rules find the invite being redeemed |

The id is a random Firestore id for new couples, or a user's uid for older ones (created lazily by `ensureCouple`).

## `invites/{code}`: single-use partner invite

`coupleId`, `createdBy`, `createdAt`, `expiresAt` (24 hours later), `used`, and once redeemed `usedBy`, `usedAt`.
The document id is the 10-character code (alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`).

## Cloudinary

Cloud name `jpxtr4kd`, unsigned upload preset `pind_map`. Thumbnails are produced client-side by rewriting
`/upload/` to `/upload/c_fill,w_300,h_300,q_auto/` in the URL. Photos are never deleted from Cloudinary when
a memory is removed (the app can't do that with an unsigned preset).

## Security rules

`firestore.rules` (strict; tested in `firestore-tests/`; rollout in [SECURITY_ROLLOUT.md](SECURITY_ROLLOUT.md)):

- Cities, places and memories: read and delete by couple members only; create only into your own couple with a valid
  shape (field names, types, lengths; a memory has at most one photo and it must be from this app's Cloudinary
  account; `createdBy` must be you). Cities are never edited, places only get a rating (0 to 5), memories only a new
  visit date.
- `users`: you read your own profile and your partner's; you write only your own; `coupleId` can only point at a couple
  that lists you; the e-mail must equal your sign-in e-mail.
- `couples`: members read one; nobody lists. New couples start with only their creator and a random 20-character id.
  The only update is a second person joining with a valid invite, in the batch that marks the invite used.
- `invites`: readable by id by anyone signed in (the code is the secret), never listed; created by members, 24 hours
  maximum; can be marked used only together with the redeemer joining the couple; the creator can delete it.
- Everything else is denied.

Until the rules are published in the Firebase console, the live database still runs the old rules (any signed-in
user).

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
