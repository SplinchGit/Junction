# Junction development

- The canonical checkout on this PC is `C:/Users/jf358/Documents/Junction` on `main`. Create no feature branches. Commit and push only `main`; use fast-forward integration and preserve existing local edits. Never force-push.
- Codex and Claude share the same objective, Foreman work record and candidate checkout. Only one coding provider writes to a candidate at a time. Foreman uses detached checkpoints for isolated verification. Review and apply the exact patch in the canonical checkout before committing to `main`.
- The owner, Codex, or Claude can propose an objective. Nethra maintains the queue and schedules approved work through existing provider limits. Nethra does not edit or commit Junction source. Pause and Stop take precedence over pending retries and handoffs.
