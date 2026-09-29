# Solar Statistik — iOS (Capacitor)

Native iOS shell around the same Vite/React app. The Growatt API token is stored in the **Keychain** on device; the HACS web panel keeps using `localStorage` as before.

## Prerequisites

- macOS with **Xcode** (from the Mac App Store)
- **Node.js** 20+ (same as the web project)
- Apple ID (free **Personal Team** is enough — no App Store publish required)

## First-time setup

From the repository root:

```bash
npm install
npx cap add ios
```

You only run `cap add ios` once. It creates the `ios/` Xcode project locally (not required in git if you prefer a clean clone + add).

## Build and open in Xcode

```bash
npm run build:ios
npx cap open ios
```

`build:ios` compiles TypeScript, builds the web assets with Vite `base: './'` (required for the embedded WebView), then runs `cap sync ios`.

In Xcode:

1. Select the **App** target → **Signing & Capabilities** → Team: your Apple ID / Personal Team.
2. Pick a simulator (e.g. iPhone 16) or a physical iPhone connected by cable.
3. **Product → Run** (⌘R).

On a real device, trust the developer certificate under **Settings → General → VPN & Device Management** if iOS asks.

## Day-to-day workflow

After UI or logic changes:

```bash
npm run build:ios
```

Then run again from Xcode (or use **Product → Run** if the project is already open).

## Growatt token

In **Settings** in the app, enter the Growatt token as on the web. On iOS it is saved via `@aparajita/capacitor-secure-storage` (Keychain). Other settings remain in the usual config JSON in WebView storage, without the token field.

## Troubleshooting

- **White screen**: ensure you used `npm run build:ios` (relative `./` base), not `npm run build` (HACS `/solar-statistik/` base).
- **Pod errors**: from `ios/App`, run `pod install`, then reopen the `.xcworkspace`.
- **Signing**: bundle id must match `de.nils.solarstatistik` in `capacitor.config.ts` unless you change both places consistently.
