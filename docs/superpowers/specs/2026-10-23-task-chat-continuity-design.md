# Task–chat continuity

Keep objective management inside chat. A compact strip appears only when the current conversation has linked objectives; it shows state, current step and next wake. Selecting it opens the existing task detail. The global Tasks control remains a compact index. Selecting an indexed objective opens its linked conversation; an unlinked objective receives one host-created conversation on demand. Objective state remains authoritative on Windows and is never inferred from chat prose.

The host returns `conversationId` in objective summaries and offers an idempotent `nethra.openChat` operation. A retry after a lost response must return the same ID. The host creates the conversation before recording the association, using a deterministic ID so a crash between the local JSON and SQLite writes can recover. A deleted conversation must never be resurrected from a tombstone. Android requests the host operation and syncs the resulting conversation before switching, while offline task details remain readable but opening an unlinked chat requires the host. The same objective may be reached from either client.

Keep the current approval and objective controls behind an expanded detail. Avoid new polling or inference. The existing 60-second LAN and 180-second relay status polling remains the mobile source of task summaries.
