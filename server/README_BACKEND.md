# Server: how CI/docker deploy works

This repository now includes a small TypeScript Node backend that proxies chat requests to an LLM provider (OpenAI by default).

Running locally (development):

1. cd server
2. cp .env.example .env and set OPENAI_API_KEY and any other vars
3. npm install
4. npm run dev

Run Docker (production):

1. cd server
2. npm run build
3. docker build -t splinch/junction-backend:latest .

Notes:
- The streaming endpoint (/api/chat/stream) currently uses a simple chunking shim for compatibility: the server fetches the full reply from OpenAI then streams it in small pieces to the client so the client can begin TTS playback early. This avoids implementing the OpenAI streaming protocol for now but still supports a streaming UX.
