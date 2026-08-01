# Planning

## Purpose

Planning turns proposed tool calls into an explicit, inspectable plan and manages that plan from proposal through completion or cancellation.

## Main Entry Point

- `PlanCoordinator.kt`

## Responsibilities

- build plans from pending tool calls;
- expose approval, cancellation, and resume state;
- coordinate ordered execution through `PlanExecutor`;
- retain plan lifecycle state for recovery and audit.

## Does Not Own

- tool-specific side effects;
- trust and provenance rules;
- approval user interface.

## Flow

tool calls → plan proposal and approval → ordered execution result
