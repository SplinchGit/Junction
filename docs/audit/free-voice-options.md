# Free voice options for Junction

Researched 27 September 2026. **Nothing installed or implemented; no speech
endpoint called.** These are candidate architectures, not benchmark results on
James's phone. Longevity cannot be guaranteed; locally runnable engines and
downloaded models reduce reliance on a free hosted tier continuing to exist.

| Option | Why it fits | Main trade-off |
|---|---|---|
| **sherpa-onnx: local recognition + local TTS** | Android examples include streaming recognition and a system TTS engine; one runtime family can cover both directions without per-minute API charges | Model choice, phone latency, memory/battery and individual model licenses need validation |
| **whisper.cpp recognition + local TTS** | A maintained native recognition engine with an Android sample; pair with sherpa-onnx TTS or an offline Android voice | Recognition alone is not a complete conversational voice stack; incremental decoding, turn detection and latency need work |
| **Android on-device SpeechRecognizer + offline TextToSpeech** | Smallest integration and no self-hosted service; check on-device recognizer availability and select a voice that does not require a network | Availability and quality vary across OEMs, installed engines, languages and OS versions; cannot promise the same voice everywhere |

**My first candidate is sherpa-onnx**, with Android's built-in offline facilities
as a lightweight fallback. It provides a clearer path to owning both speech
directions than relying on a changing hosted free allowance. Whisper.cpp is worth
comparing if transcription quality on James's accent is stronger in a local test.
This recommendation is an engineering inference from their supported interfaces,
not a claim that one has won a quality/latency test here.

All three still need Junction's existing turn-taking, interruption, audio-focus,
Bluetooth and cancellation behavior. “Free speech” also does not make a selected
cloud LLM free: a fully local setup needs local inference as well. A Windows-hosted
local speech engine is another deployment choice for weaker phones, but then
voice depends on that PC being awake and reachable.

## Primary sources

- [sherpa-onnx Android recognition/TTS examples](https://k2-fsa.github.io/sherpa/onnx/android/prebuilt-apk.html)
- [sherpa-onnx Android TTS engine](https://github.com/k2-fsa/sherpa-onnx/blob/master/android/README.md)
- [sherpa-onnx runtime license](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE)
- [whisper.cpp Android sample](https://github.com/ggml-org/whisper.cpp/blob/master/examples/whisper.android/README.md)
- [whisper.cpp runtime license](https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE)
- [Android on-device SpeechRecognizer API](https://developer.android.com/reference/android/speech/SpeechRecognizer)
- [Android Voice network requirement API](https://developer.android.com/reference/android/speech/tts/Voice)

Review the license of the exact voice/recognition weights separately from the
runtime license before bundling them. No voices/models were downloaded this pass.
