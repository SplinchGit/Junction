# Tools

## Purpose

Tools define the actions available to the assistant, their risk metadata, dispatch logic, and postcondition checks.

## Main Entry Point

- `ToolExecutor.kt`
- `ToolRegistry.kt`

## Responsibilities

- publish model-facing tool definitions;
- dispatch approved calls to existing feature and platform capabilities;
- validate egress and return structured results;
- verify observable postconditions after execution.

## Does Not Own

- plan approval and lifecycle state;
- provider calls or conversation persistence;
- trust-policy decisions.

## Flow

approved tool call → dispatch and side effect → structured result and verification
