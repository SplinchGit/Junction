# Junction

Android MVP scaffold for Junction: a calm social operations hub with a feed + AI triage chat.

## What is included
- Kotlin chat core (`app/src/main/java/com/splinch/junction/chat`)
- Compose chat UI (`app/src/main/java/com/splinch/junction/ui/ChatScreen.kt`)
- Feed UI with mock events (`app/src/main/java/com/splinch/junction/ui/FeedScreen.kt`)
- Background digest scheduler (WorkManager + notifications)
- HTTP backend hook (`HttpBackend`) ready for your API

## Quick start
1. Open in Android Studio.
2. Sync Gradle.
3. Run on device/emulator.

## Backend hook
`HttpBackend` posts to `/chat` with:
```
{
  "sessionId": "...",
  "message": "...",
  "messages": [{ "role": "user|assistant|system", "content": "..." }]
}
```
It expects a response like:
```
{ "reply": "..." }
```

## Notes
- Notifications on Android 13+ require user permission (prompt shown on launch).
- Background work uses WorkManager (default 30-minute interval).
