# Activity Map

A shared map for a couple. Save the cities you've visited, pin places inside them, and attach notes, dated
photos and star ratings to each place. There's a photo gallery, an "On This Day" memories view, and basic stats.

Built with Expo (SDK 58), React Native, expo-router, Firebase (Auth and Firestore), react-native-maps,
Cloudinary (photo hosting) and OpenStreetMap Nominatim (search).

## Run it

```bash
npm install
npx expo start
```

Open it in Expo Go or a development build on a phone or emulator (the map and bottom sheet don't work well on web).

## Docs

- [AGENTS.md](AGENTS.md) / [CLAUDE.md](CLAUDE.md): quick guide for AI coding agents
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): screens, map modes, how features work
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md): Firestore collections and fields
- [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md): what's broken, suspected causes, security notes

## Setup you must do yourself

- A Firebase project with Email/Password auth enabled and Firestore created. The config is in
  `src/config/firebaseConfig.ts`. Publish the rules from `firestore.rules` in the Firebase console.
- A Cloudinary cloud with an unsigned upload preset (see `src/components/CityDetailSheet.tsx`).
