# Nethra live task log implementation

1. Add failing Windows tests for timestamped model/tool activity and active task status. Add failing tests for ongoing continuous follow-up and toggles during active or sleeping work.
2. Record bounded public activity from the runner and surface it through the existing progress view and API.
3. Make the Android list use rectangular text rows that open task detail, add a separate chat action, and refresh selected LAN task details frequently enough to see steps arrive.
4. Run focused and full Windows tests, Android unit/build and emulator checks; package and launch the Windows host following `apps/windows/AGENTS.md`.
5. Push to the existing over-the-air Android build route and verify that its latest manifest names the delivered commit.
