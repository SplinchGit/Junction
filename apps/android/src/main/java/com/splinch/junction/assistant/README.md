# Assistant

## Purpose

This folder contains the AI assistant's orchestration and policy-independent core behaviour. Its packages separate conversation state, context, providers, planning, trust, tools, memory, and the runtime facade.

## Main Entry Point

- `runtime/ChatManager.kt`

## Responsibilities

- accept owner input and assemble trusted context;
- route model requests and stream responses;
- hand tool requests through planning, trust, execution, and verification;
- coordinate the focused services in this folder.

## Does Not Own

- feature-specific screens or voice implementations;
- Room, preference, and secret-storage implementations;
- direct Android platform integrations.

## Flow

owner input → context and provider routing → response or approved tool plan
