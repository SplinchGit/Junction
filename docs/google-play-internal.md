# Trusted Junction updates through Google Play

Junction's GitHub Pages APK is a sideloaded debug build. Google Play Protect may
scan any unfamiliar sideloaded APK; an app cannot whitelist itself or suppress
that system security prompt.

The `Publish Android to Play Internal Testing` workflow provides the trusted
update channel. Release builds remove Junction's APK-install permission and use
Google Play for updates.

## One-time Play Console setup

1. Create Junction in Play Console as an app with package
   `com.splinch.junction` and enable Play App Signing.
2. Create an internal-testing track and add the owner's Google account as a
   tester.
3. Create a Google Cloud service account, grant it release access to Junction
   in Play Console, and download its JSON key.
4. Generate a dedicated upload keystore. Do not use the committed debug key as
   a Play signing key: it is public development material.
5. Add these GitHub Actions secrets:

   - `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` — the complete service-account JSON
   - `ANDROID_RELEASE_KEYSTORE_BASE64` — base64 of the upload keystore
   - `JUNCTION_RELEASE_STORE_PASSWORD`
   - `JUNCTION_RELEASE_KEY_ALIAS`
   - `JUNCTION_RELEASE_KEY_PASSWORD`

The workflow safely skips publishing until all five secrets exist. Once they
are present, each push to `main` builds a signed Android App Bundle and sends it
to the internal track.

## Moving the existing phone install

The current GitHub APK and the Play build use different signing identities.
Android cannot replace one with the other. Export any Junction settings that
must be retained, uninstall the sideloaded build once, opt into the internal
test, and install Junction from Google Play. Subsequent internal-track releases
arrive as ordinary trusted Play updates.

Keep the GitHub debug APK for development only. Do not alternate between the
debug APK and the Play build on the same installation.

## Google Play Points

Play Points is not an install/update trust system. It applies when an eligible
Play-distributed app or game sells one-time products or subscriptions through
Google Play Billing. Junction currently has no Play Billing catalog, so Points
does not apply to Junction itself yet. Mafioso would be the more natural fit:
an eligible in-game item could become a Play Points promotion after Play Billing,
server-side purchase verification, fulfilment, and Play Console approval exist.
