# Junction delegation v1

The Windows **Projects** surface is a local owner command centre. One instruction
may target one to three explicitly named Git repository roots. Planning is
read-only: Junction records the current branch and base commit and reports a
missing, nested, non-Git, or dirty repository as `needs_setup`.

After explicit plan approval, each ready project receives its own
`junction/delegation/<run>/<project>` branch and worktree. Codex is spawned with an
argument array (`shell: false`), workspace-write sandboxing, and a prompt forbidding
push, merge, other repositories, and broad machine access. Progress and terminal
states are persisted locally. An agent can stop at `JUNCTION_DECISION_REQUIRED`;
the owner's answer resumes only that project.

Successful work must be committed and leave a clean worktree. Junction computes a
SHA-256 over the binary Git diff. Review records `{baseSha, headSha, diffHash}`.
Merge approval re-computes all three, verifies the target repository is clean and
still at the reviewed base, and only then performs a no-fast-forward local merge.
There is no automatic push or remote execution. Cancellation stops the process but
preserves its worktree and branch. Lifecycle events are append-only JSONL under the
app's local user-data directory.

Current v1 limitations: test results are agent-reported rather than independently
re-run by the coordinator; no session-resume token is retained; and setup blockers
must be resolved outside the app. These are the next hardening targets before
delegation is treated as production merge automation.
