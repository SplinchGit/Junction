# M6 voice baseline

Record the Android build SHA, phone model, recognition engine, audio route, and background noise conditions. Use the paired local voice route. Hold those settings constant for any repeat run. Use synthetic prompts and capture only the JunctionVoice stage markers.

Run 25 rounds of these four scenarios, using a fresh turn for each scenario. Note the start and end time of each trial. Count an attempted turn even when it fails. Repeat only invalid trials, such as an unrelated app taking the microphone, and record the reason separately.

| Scenario | Script | Expected behavior |
| --- | --- | --- |
| Mid-sentence pause | Say “Tell me about” then pause one second and finish “the water cycle.” | One owner utterance contains the full request. |
| Backchannel | Ask for a three-sentence explanation. Say a brief “mm-hm” during the second sentence. | The reply continues through the last sentence. |
| Normal turn change | Wait for the spoken answer to finish, then say “Give me one example.” | The next user utterance is recognized and gets a reply. |
| Intentional interruption | During the second sentence say “Stop. Give me just one sentence instead.” | Playback stops, the new request is recognized, and the next reply follows it. |

Use the companion voice tooling or collect the stage log with:

    adb logcat -v threadtime JunctionVoice:I '*:S'

For each scenario report attempted turns, turns that matched the expected behavior, barge-ins, and barge-ins with a subsequent empty recognition or recognizer failure. Count stage=bargein_no_transcript lines for the last metric. Report the subset with reply_interrupted=true separately. Also record any audible reply that truncated and did not resume. A trace marker identifies interrupted playback. The listening observation establishes whether the reply was lost.

Keep the baseline settings for all 100 turns. Use the observed losses to decide whether to change reply recovery, then rerun the same protocol before considering an adjustment to barge-in timing.

Baseline status: awaiting a connected Android phone.
