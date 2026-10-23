# Continuous objectives (23 October 2026)

Nethra has one Windows-hosted executive and one 30B inference queue. A task is either **finite**, ending after verified completion, or **ongoing**, returning to sleep after a verified milestone. The latter is useful for requests such as “keep me updated”. Both types use the existing SQLite lease, approval, attention, budget, and journal machinery. Old objectives remain finite.

The host chooses the next routine monitoring checkpoint from the objective's autonomy profile: Active after six hours, Balanced after one day, Quiet after seven days. New Calendar/Gmail revisions can wake an objective earlier. When all selected sources are healthy, the prior milestone has completed, no plan step is pending, and no reasoning attention or direction check-in is due, a routine wake records `MONITOR_IDLE` and reschedules without invoking the model. A disconnected or stale source is never described as checked. Repeated short wakes with no meaningful progress stop after six cycles and request user direction.

Verified milestones are journal events. The host delivers each milestone to the originating chat using a stable message ID and a durable local delivery cursor; a restart can retry delivery without creating duplicate messages. Routine unchanged checks stay in the journal. The Windows objective panel and Android companion expose objective type, status, active step, progress, and next wake. Android keeps an encrypted last-synced snapshot and marks it stale when the PC connection fails. Android does not schedule objective work.

The Calendar and Gmail source watchers require the owner's independent Windows OAuth grants. Hostel Wi-Fi client isolation remains a network constraint; the encrypted Firebase relay or a private network can carry companion requests. This patch does not change Firestore rules or OAuth scopes.

Verification should distinguish mocked scheduler/model tests, a packaged Windows host run, and a physical phone round trip. An APK build and emulator/unit test do not establish physical phone connectivity.
