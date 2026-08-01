# Trust

## Purpose

Trust evaluates whether an assistant-proposed action is allowed, requires owner approval, or must be blocked based on provenance, risk, and Junction policy.

## Main Entry Point

- `TrustGate.kt`

## Responsibilities

- distinguish owner instructions from untrusted content;
- apply risk-tier and policy checks to tool calls;
- produce explicit allow, confirm, or block decisions.

## Does Not Own

- executing tool side effects;
- rendering approval prompts;
- provider selection or response generation.

## Flow

proposed action and provenance → policy evaluation → trust decision
