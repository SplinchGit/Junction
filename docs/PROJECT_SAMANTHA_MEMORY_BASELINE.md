# Project Samantha M4 memory baseline

Run on 13 Nov 2026 against source `54a947b`, before any memory change. The owner asked for a small test instead of the guide's 30 questions over a 30 day history.

## Method

The fixture is `apps/windows/test/fixtures/samantha-memory-baseline.json`: 23 fictional owner facts stated over one simulated week, seven of them later corrected, and 18 questions. `apps/windows/scripts/samantha-memory-baseline.js` adds the facts through `LocalDataStore.addMemory` in a temporary directory, then asks each question through `LocalAgentRuntime.run` on `qwen3:30b` in a fresh conversation. Tools are disabled so an answer can only come from recalled memory. The installed profile is not touched.

This is integration evidence for the host chat runtime. It did not go through the app window, the phone, or shared-state sync.

The script's automatic marks are a first pass. The scores below are from reading every reply. The automatic marks were wrong on four replies: three that named both the old and new fact were marked as passes, and one honest "the airline isn't listed" was marked as a failure.

The fixture was revised once, before any source change. The first run showed that corrections worded as corrections ("Dr Hale has left", "moved to") are answerable from their own text, so three corrections stated as plain facts were added.

## Results

| Ability | Score | What happened |
| --- | --- | --- |
| Recalling a stated fact | 3 of 3 | Correct. |
| Combining facts | 2 of 2 | Correct. A third question, the combined monthly cost of two items, was not measured: the host forces a web search for it and tools were disabled. |
| Time | 0 of 3 | Twice she said no date is stored. Once she invented one, saying the deadline change was confirmed "on 2026-11-13 (today's date)". |
| Updated fact, worded as a correction | 3 of 3 | Correct, by reading the wording of the newer fact. |
| Updated fact, stated plainly | 0 of 3 | She listed both values as current, or asked which was right. Recall returned both records with nothing to order them. |
| Admitting she was never told | 3 of 3 | Correct. |

Recall took 0.08 ms on average (0.21 ms maximum) over 23 facts. A memory write took 1.2 ms. An answer took 14 seconds on average on the i7-6700K and RTX 2060 host with the model already loaded.

## 80B before and after the memory change

The owner's chat model is `junction-qwen3-next-thinking:80b-q4km`, so the comparison that counts is on that model. "Before" ran at `54a947b`. "After" ran at `7ccd15b` on 14 Nov 2026, with each fact dated to its fixture day and the automatic trace judging every fact as it was added. Scores are from reading every reply, one run each.

| Ability | Before | After | Notes |
| --- | --- | --- | --- |
| Recalling a stated fact | 3 of 3 | 3 of 3 | |
| Combining facts | 2 of 2 | 2 of 2 | The third question is unmeasured in both runs (forced web search, tools disabled). |
| Time | 0 of 3 | 3 of 3 | Before: no dates stored, and one reply was empty. After: correct dates. "Four days ago" is correct for a run on 14 Nov; the fixture's expected "three" assumed 13 Nov. That reply also carried a citation tag, `[S1.p1]`, that refers to nothing. |
| Updated fact, worded as a correction | 1 of 3 | 3 of 3 | Before: one reply asked which car was current and one was empty. |
| Updated fact, stated plainly | 0 of 3 | 3 of 3 | Before: both values given as current. |
| Admitting she was never told | 3 of 3 | 3 of 3 | |

The trace judged 15 facts that had a possible earlier match. It retired the right earlier fact for all seven corrections and retired nothing else. Every verdict came from the local 80B model; none was marked unsure, so the Claude step was not exercised in this run. It is covered by unit tests, and the Claude call it uses was checked live separately. A judgement took 65 seconds on average (185 seconds at most, including the model load). An answer took 44 seconds on average.

The two empty replies in the "before" run were the model spending its whole output allowance on reasoning. That was fixed separately in `7c43593` and did not recur in the "after" run, which started before that fix.

Limits of this evidence: one run of 18 questions, through the host chat runtime and not the app window or the phone. Supersession does not sync, so the phone still treats both facts as current.

## What M4 had to change

Records carry no date and no successor, so the model cannot tell which of two contradicting facts is current and cannot answer when something was said. Steps 2 to 5 should move the plain-update and time rows without lowering the others. The invented date in the time row is the case step 5 addresses: when no date is stored, the context should say so.

Re-run with `node scripts/samantha-memory-baseline.js <output.json>` from `apps/windows`, and mark the replies by reading them.
