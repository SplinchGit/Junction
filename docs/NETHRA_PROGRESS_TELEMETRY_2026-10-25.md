# Nethra progress and performance, 25 October 2026

Junction now supplies an objective-native `performance_report` tool. It reads completed model inference intervals from Nethra's SQLite journal and recent local chat timings from Junction's saved usage records. The report covers up to seven days of retained samples and gives counts, medians and latest sample times. It includes no prompts, message bodies or private reasoning. Nethra can inspect it without asking the owner for a metrics folder. A snapshot is a baseline, not proof of improvement; comparable before-and-after runs are still needed.

Windows and Android task details now lead with current state, next action and steps completed in the current cycle. A bounded host-recorded activity timeline distinguishes tool results, Codex advice and daily budget waits. A performance card labels task model time separately from local chat response time across conversations. Missing samples are shown as unavailable. Nethra's own note remains separate from the verified activity.

The report uses existing local records, so it does not trigger a model call or spend Codex allowance. Existing task controls, connected chats and daily work limits are unchanged.

The Android debug APK for this change is built and available from the Android CI run. The Play Internal Testing workflow did not publish it: this repository lacks its Play service-account and release-signing secrets. The workflow now reports that skipped release explicitly; a manual publish attempt fails instead of appearing successful. A release-signed bundle and Play upload still require those credentials.
