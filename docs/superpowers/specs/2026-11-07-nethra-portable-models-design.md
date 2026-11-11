# Nethra portable model selection

Nethra's durable objectives must be able to continue with either local model. The owner can switch a task between Qwen3 30B and Qwen3-Next 80B without losing its plan, evidence, approvals, or checkpoint. Keep 30B as the default for existing and new tasks until the owner chooses 80B. Model choice is execution configuration, never part of the task's working memory.

The downloaded 80B Ollama manifest appends an unconditional `<think>` to chat prompts and returns empty replies. A local Ollama alias with a corrected template shares the downloaded weights. The app selects the alias; the raw upstream tag remains available for recovery. 30B requires thinking, while the 80B alias runs with thinking disabled. Both use the same Nethra tools, state machine, and durable SQLite record.

The existing continuous task pacing, owner messages, and checkpoint reconstruction remain in force. A model switch takes effect on the next model call; no task content is rewritten. A task that is currently running must finish or yield before its model can be changed. Show the selected model in task controls and activity. A cold 80B load is slow and uses most available host RAM, so failures should remain visible and never silently fall back to another model.

Approaches considered: a single global model switch would unexpectedly change every active task; separate 30B and 80B harnesses would split task state. Per-task model selection with a shared harness preserves continuity and owner control. Model-specific settings stay in a small registry.
