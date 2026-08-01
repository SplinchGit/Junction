# Voice

## Purpose

Voice contains Junction's local and realtime spoken-conversation capability, including speech recognition, synthesis, call state, interruption handling, and its foreground service.

## Main Entry Point

- `VoiceCoordinator.kt`

## Responsibilities

- select and switch the configured voice backend;
- coordinate local and realtime sessions;
- expose microphone, listening, speaking, and connection state;
- connect voice sessions to the foreground call service.

## Does Not Own

- text-chat provider routing;
- general assistant planning and trust policy;
- reusable Bluetooth platform implementation.

## Flow

microphone input or text → selected voice session → speech, transcript, and tool events
