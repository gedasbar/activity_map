# Rolling out the strict security rules

The code for this is in the repo and tested, but **nothing changes in your live database until you do the steps
below, in this order.** Publishing the new rules before the migration would lock the app out (it would show
permission errors) until you put the old rules back. That is safe to undo, but avoid it.

What changes for the two of you: nothing you can see. What changes for everyone else: they can no longer read or
write anything.

## 0. What you are protecting against

Before: any account on the project could read, change or delete every city, place, memory and profile. After: only
the two members of a couple can touch that couple's data, only valid shapes can be written, and the only way to
join a couple is a single-use 24-hour invite that its member created.

## 1. Merge the pull request and update your folder

```bash
git checkout main
git pull
```

## 2. Take a fresh backup

Follow [scripts/README.md](../scripts/README.md): generate a service account key (step 1), then

```bash
cd scripts
npm install
npm run backup:photos
```

Copy the new `backups/<date-time>` folder somewhere safe.

## 3. Dry run of the migration

Same `scripts` folder, same key:

```bash
npm run migrate
```

It changes nothing. The plan should look like this for your database (ids shortened here):

```
Plan
  - create couples/gEm3w326... with members [BTkGGGP0..., gEm3w326...]
  - fill users/gEm3w326...: uid=gEm3w326..., email=<your e-mail>
```

and it should print **no** lines under "Problems that must be fixed first". If it shows anything else (a third
member, data that belongs to no couple, a missing sign-in account), stop and send me the output.

## 4. Apply the migration

```bash
npm run migrate:apply
```

It saves the previous state of the two documents it changes to `backups/migration-<time>/before.json`, writes them,
and reads them back to check. It does not touch any city, place, memory or photo. Running it again does nothing.

Open the app on both phones. Everything should look exactly as before (the old open rules are still active).

## 5. Publish the new rules

1. Before you replace anything, open the Firebase console, Firestore Database, **Rules**, and copy the current text
   somewhere. It is the three lines `allow read, write: if request.auth != null;` you pasted earlier.
2. Replace the whole text with the contents of [firestore.rules](../firestore.rules) and click **Publish**.

## 6. Check it on your phones (about five minutes)

On both phones:

- Open the app: the map, your cities and your places appear.
- Open a city, open a place, see its memories and photos.
- Add a place, add a memory with a photo, give a place a rating, change a memory's date, delete the test memory.
- Menu, Gallery and Memories tabs load; Sync tab shows both of you.

If **anything** shows a permission error, go to step 7 and tell me what you were doing.

## 7. Rollback (always possible, takes a minute)

Paste the old rules back (step 5, point 1) and publish. The migration only added documents the old rules ignore, so
the app works exactly as before. You can also restore the migrated documents from `before.json`, though there is no
need to.

## 8. Clean up

Delete the service account key in Google Cloud (Manage keys) and the `scripts/serviceAccountKey.json` file.

## What the tests prove

`firestore-tests/` runs 100 checks against the local emulators (never the real project):

- every rule, with a mutation check (twelve rules weakened one at a time; the tests caught ten, and the other two
  are checks that a second rule also enforces)
- the exact batched write the app uses to join a couple
- the app's real `firestoreService.ts` running under the rules as different signed-in users, for a brand new couple
  and for your existing one (28-character couple id, slug city ids, profile with only a `coupleId`)
- the migration script against a copy of your situation, including refusing unsafe cases

```bash
cd firestore-tests
npm install
npm test
```

(Needs Java, which you already have, because the Firestore emulator runs on it.)

## Not covered yet

- Photos are still uploaded to Cloudinary with an unsigned preset. Anyone who finds the preset name can upload to
  your Cloudinary account; restrict it in the Cloudinary settings (the roadmap has the steps).
- The Firebase API key is still unrestricted and App Check is not on (see the roadmap).
- Leaving a couple, or moving to a new partner, is not possible yet.
