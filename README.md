# Junction

Minimal Android scaffold for the Junction chat layer, with a Kotlin port of the AGI chat handler.

## What is included
- Kotlin chat core (`app/src/main/java/com/splinch/junction/chat`)
- Compose chat UI (`app/src/main/java/com/splinch/junction/ui/ChatScreen.kt`)
- Stub backend (`StubBackend`) ready to be replaced by a real API client

## Next steps
- Replace `StubBackend` with your OpenAI-backed implementation.
- Swap `InMemoryConversationStore` for a persistent store (Room, DataStore, etc.).
- Add notification ingestion and timeline UI for Junction feeds.

## Notes
This repo does not include the Gradle wrapper. If Android Studio prompts, let it generate the wrapper or run `gradle wrapper`.
