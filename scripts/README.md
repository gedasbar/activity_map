# Maintenance scripts

These run on your computer with Node. They are not part of the app. They use the Firebase Admin SDK,
which needs a **service account key**: a file that gives full access to your Firebase project.

## Backup (`backup.mjs`)

Read-only. It saves:

- every Firestore collection (`users`, `unlocked_cities`, `saved_places`, `visited_logs`) as JSON
- the list of sign-in accounts (uid, email, dates; no passwords or hashes)
- optionally every photo file from Cloudinary (`--photos`)
- `report.json`, a summary of how the data hangs together

It never changes Firestore or Authentication. Everything goes into `backups/<date-time>/`, which is
git-ignored.

### 1. Get a service account key (free)

1. Open the [Firebase console](https://console.firebase.google.com/) and pick the project **activity-map-155d8**.
2. Click the gear icon next to "Project Overview", then **Project settings**, then the **Service accounts** tab.
3. Click **Generate new private key**, then **Generate key**. A `.json` file downloads.
4. Move it to `scripts/serviceAccountKey.json` (this exact name; git ignores it).

**Treat this file like a master password.** Never commit it, send it to anyone, or paste it into a chat
(including with an AI assistant). When you are done, go back to the same tab, open
"Manage service account permissions" in Google Cloud, and delete the key you created.

### 2. Run it

```bash
cd scripts
npm install
npm run backup:photos
```

Drop `:photos` (`npm run backup`) for a quick data-only backup. Photos can take a few minutes; running it
again skips files already downloaded.

When it finishes it prints a summary. Open `backups/<date-time>/report.json` to see:

- `userDocsWithoutAuthAccount`: people in the database whose sign-in account no longer exists
- `authAccountsWithoutUserDoc`: sign-in accounts with no database profile
- `dataNotMatchingAnyUsersCoupleId`: saved data that no user points at (should be `none`)

Copy the whole `backups/<date-time>` folder somewhere safe (another drive or cloud storage). It contains
personal data and photos, so don't put it in a public place.

### Restoring

There is no restore script yet. The JSON files contain every document with its id, so a restore script can be
written if needed. Photos stay on Cloudinary regardless; the download is a second copy.
