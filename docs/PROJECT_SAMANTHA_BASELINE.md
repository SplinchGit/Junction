# Project Samantha M0 baseline

## Installed host

The source checkout was at `66ef4f75ca5c54371b47000b7ea984a562d2c4d9`. The running package was `samantha-handoff-card-final-20261113`, with an `app.asar` SHA-256 of `cd465dac89641fdfdf636430edd6f78eaa3af8c432b1efb6ca6bc076effc2a7f`. The packaged store, scheduler, and runner match the checkout after newline normalization. The startup and Foreman executor files differ, so use the package hash as the installed build identity.

A read-only query of the live `settings` row found schema version 6. Nethra, thinking, verbose output, persistent startup, child delegation, and task agents were enabled. The wake window was 300,000 to 604,800,000 ms. The global and objective inference budget overrides were null. The advisor reserve was 10%. Warm-on-startup was `desktop`, idle retention was `2h`, and proactive updates were `ALL`. Quiet hours were disabled with saved hours 22:00 to 07:00. Voice invitations were disabled. The notification device identifier is omitted.

## Audit objective

**Title** Windows and Android continuity audit

Use ten substantive work passes on the existing installed host. Produce one independently checkable finding per pass, with its evidence source, observed outcome, and next step. Cover objective creation, task identity, phone sync, wake scheduling, checkpoint recovery, owner controls, approval receipts, model changes, engineering handoffs, and verified completion. Use local, read-only inspection and existing receipts. Mark any finding that cannot be verified with the missing evidence. Do not alter source, call paid providers, or approve actions to obtain a finding.

Record the objective ID and compare its journal and usage rows. Count `CLAIMED`, `NO_NEW_EVIDENCE`, `NO_NEW_EVIDENCE_STOPPED`, `YIELDED`, `RETRY_SCHEDULED`, `BUDGET_WAIT`, and `nethra_budget_reached`. Report inference minutes, time from first claim to `nethra_completed`, provider allowance where applicable, useful and idle wakes, and deduplicated owner interventions excluding setup.

## Run status

The audit was submitted through the Junction objective creation API after Windows input could not open Tasks. The installed package and checkout have matching objective API and store files. Submission used the normal request receipt and objective creation transaction without editing the live conversation file. The installed scheduler claimed objective `3ea1e942-1894-4d1e-af69-6f587f18e1f4` and started a Qwen 30B pass. The run finished without an owner intervention.

## Baseline results

The journal recorded 1 claim, 19 model steps, 10 completed plan steps, 6 retained tool results, and 1 completion. Each of the six stop events listed above occurred zero times. Inference took 1,076,071 ms (17.93 minutes), and first claim to completion took 1,076,375 ms (17.94 minutes). There was 1 useful wake, 0 idle wakes, and 0 owner interventions after submission. No external advisor ran.

The result falls short of the intended ten-session baseline. Several findings relied on historical documentation rather than live Windows and Android observations. The host recorded a completion, but the audit did not independently verify every finding. A completed workspace draft receipt exists even though the brief requested read-only work. No approval receipt was recorded. The final audit needs a host-enforced read-only scope and ten distinct substantive wakes.

The two failed calls were `update_plan` with missing `arguments.steps`, and `finish_objective` without a completed draft-write receipt. The first is an argument-shape error. The second is the host enforcing a completion precondition.
