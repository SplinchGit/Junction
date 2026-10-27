# Nethra unified agent and learning loop

## Intent

Nethra should be one agent whether the owner speaks in its connected chat or the scheduler wakes it. It should retain the relevant state of an unfinished task, use the same host-defined capabilities in either entry point, carry out useful work in successive passes, and ask for a specific owner decision only when the host cannot supply the answer. This is an orchestration and evaluation programme, not model distillation. The owner wants Nethra to learn from bounded attempts and verified feedback while keeping code implementation behind Codex review and owner control.

## Current evidence and constraints

The 26 October Self Improvement run ended `WAITING_FOR_USER` after six unproductive wakes. Its journal contains 40 claims, 216 model steps, 72 `propose_code_work` starts, 51 Codex consultation reservations, and 120 context compactions. In 69 compactions, the context estimator still reported a prompt over its 6,400-token budget. Earlier proposals hit the project snapshot limit; later proposals repeatedly received `REVISE`. No new code change or speedup was verified by that task. The chat subsequently claimed it could not inspect GPT quota although the host's signed-in Codex limit reader works.

Chat currently uses `LocalAgentRuntime` and `LocalAgentToolRegistry`; tasks use `NethraRunner` and `NethraTools`. The two paths assemble different prompts, expose different tools, and handle the same linked conversation differently. Task chat messages may become owner notes for a later wake while chat itself answers with a short task-status block. SQLite task records and the task event journal are durable, but the exact unresolved reviewer objections and next hypothesis are not durable first-class state. The current fitter can return `fits: false` and the runner still calls Ollama.

Keep the current local Windows host, Ollama model, Android relay, SQLite durability, inference preemption, approved read roots, source access rules, approval receipts, and Work Activity's isolated code implementation plus owner Start and Apply gates. No model-generated statement can grant itself a capability, a folder, or approval.

## Approaches considered

1. **Harmonise prompts and add more special-case rules.** Small change, but it leaves separate state, tool, and lifecycle paths. Recent fixes of this kind did not prevent the observed loop.
2. **Use a common agent core and durable session, with chat and scheduler as entry points. Chosen.** Existing host tools can be adapted incrementally. The same task state and capability policy can be inspected from either surface, while the host keeps control of permissions and scheduling.
3. **Move the agent to a managed remote runtime.** It could supply continuation and tracing, but changes privacy, account, cost, offline behaviour, and deployment. It does not address the current need for measurable goals and bounded review loops by itself.

The owner chose less or no behavioural distinction between chat Nethra and task Nethra. The shared-core approach implements that direction without treating chat and a background wake as separate agents.

## Agent/session model

Introduce one `AgentSession` for each connected conversation and objective. Its durable state contains the owner's goal and constraints, current plan, completed and pending steps, active hypothesis, exact evidence references, reviewer objections, proposed next action, approval/interruptions, progress and stop reason. Every turn has a trigger: owner message, scheduled wake, source change, or approval result. A chat reply and a background pass call the same `AgentLoop` with the same session and the same tool registry. The trigger changes urgency and presentation, not Nethra's identity or authority.

The owner can talk to an active task in its connected chat. The message is stored as a session turn and steers the running pass or the next checkpoint. The agent's next reply and task log refer to the same state revision. A chat turn may perform a bounded amount of work immediately; if more remains, it checkpoints and the scheduler continues it. A scheduled turn may post verified progress or a specific question in that same chat. Unlinked casual chat uses the same core with an ephemeral session that can become durable when the owner requests ongoing work.

## Capabilities and authority

One host-owned capability registry defines schemas, descriptions, validation, side effects, permission requirements, and audit fields. Chat and scheduled turns receive tools from that registry according to the session's owner grants, connected sources, approved folders, and current review state. A difference in tool availability must come from those facts, never from an arbitrary chat/task split. The UI can show the same live capability manifest that the model receives. Advisor status, plan usage, task status, and applied-code status are queried from host records; if unavailable, Nethra says so.

Keep source content untrusted. The host validates each tool call at execution, including scope and approval. Read-only inspection can proceed autonomously within approved roots. Code proposals may be prepared and reviewed, but implementation starts only after owner Start; verified patches need owner Apply. Explicit code-work permission belongs to the session/objective, not to a prompt or surface. Chat messages do not silently widen it.

## Context and continuation

Build each prompt from a structured, prioritised checkpoint plus only the recent turns and evidence needed for the next decision. Preserve owner constraints, active hypothesis, unresolved objections, pending approval, exact artifact IDs, and next action across wakes. Keep raw evidence in the journal/files and retrieve it by reference when needed. Compaction writes a new structured checkpoint; it must not replace an objection with only “earlier tool result removed.”

Measure the actual submitted prompt with the production model tokenizer or Ollama prompt count where supported. Reserve generation and tool-schema space. If the final request exceeds the configured window, compact and rebuild before calling the model; if still too large, stop that turn with a diagnostic rather than sending it. Record estimated and measured input tokens, compaction decisions, and which references were included. Increasing `num_ctx` is a separate measured hardware choice, not the correctness fix.

## Work loop and stopping

Each pass follows: inspect session and host facts; choose one bounded step; call tools; verify the returned result; checkpoint; then continue, wait for a known event, or ask for a specific decision. The host owns the state transition. A model's prose cannot mark work complete, record a code change, or certify an experiment. A time or iteration limit yields a resumable checkpoint, not a fresh task with a generic summary.

Track progress by new verified evidence or a completed, checkable step, not by another proposal, advisor consultation, or rephrasing. Detect duplicate tool calls and semantically equivalent proposal fingerprints across wakes. If the same tactic fails twice, require a different action such as measuring the missing variable, narrowing the hypothesis, or reporting a concrete blocker. Continuous mode means keep taking useful bounded steps while evidence or an actionable next step exists; it does not mean endless inference. The final stop message names the last verified result, the repeated failure, and the exact owner choice if one is genuinely needed.

## Code-work tutoring loop

Separate proposal preparation from advisor review and draft creation. Use a stable proposal form: target behaviour, files/scope, baseline artifact, single change hypothesis, acceptance checks, and rollback condition. Codex reviews this form against a fixed rubric and may return corrected acceptance text or enumerated missing evidence. Persist that response as structured session state. Permit at most two reviews of one hypothesis without new evidence. Identical or near-identical requests return the prior review, not another paid consultation.

When evidence is missing, Nethra should gather it with permitted read-only tools or request one precise owner decision. It should not invent an increasingly elaborate performance protocol to get a `READY` token. Once ready, Work Activity creates an isolated draft. Owner Start authorises implementation by the coding worker; tests and exact patch review precede owner Apply. This retains the owner's requested “check with Codex and me” boundary.

## Training without distillation

Turn real task traces and owner corrections into a small replay curriculum. Include: known experiment ID; unavailable advisor and reset; repeated `REVISE`; over-budget context; owner redirect while a pass runs; a claimed code change with no commit; quota question in chat; and a task yielding at the time limit. For each case store the expected host facts, allowed next actions, forbidden claims, and useful stopping point. Run the same cases against prompt, tool, or model changes before deployment. Add scenarios as new failures occur; do not encode every conversational phrase as a new regex.

Capture a compact trace for each turn: trigger, session revision, model, prompt size, tool availability, chosen tool, tool result, evidence reference, review/approval state, timing segments, and stop reason. Show public actions and progress in Tasks; never expose private reasoning. Use code checks for hard safety and state invariants, plus reviewed trace grading for tool choice, context retention, truthful reporting, and useful progress. Keep a human-reviewed holdout set so Nethra cannot “improve” by overfitting its own training traces.

Performance work starts with separate measurements for queue, model load, prompt preparation/tokenization, prompt evaluation, generation, tools, and end-to-end owner-visible time. A change to serialization is judged on serialization time first. Any claimed response improvement requires a matched before/after workload and versioned artifacts. Observational seven-day task timings remain useful telemetry but cannot isolate a code change by themselves.

## Delivery order and acceptance

1. Enforce context fit and durable structured checkpoints. Replay a long task with reviewer feedback spanning several wakes; every submitted request must fit, and the unresolved objection must survive.
2. Move chat and background turns onto the common session/capability path. Prove the same authorised inspection and status tools are available from both; prove unapproved writes remain unavailable from both. A chat message to an active task must steer that task's next action and appear once in its journal.
3. Add bounded proposal tutoring and precise no-progress stops. Replaying the current Self Improvement trace must not generate a third equivalent Codex review without new evidence; a rejected proposal must leave an actionable next measurement or precise blocker.
4. Add the replay curriculum, trace grading and segmented telemetry. Verify false quota/code-change claims are rejected using host facts, and compare owner-visible latency on matched workloads before shipping a performance claim.
5. Roll out on Windows first, then Android's task/chat presentation and update channel after Windows tests and live task smoke pass. Preserve existing task records through a tested migration and retain a rollback path for the installed package.

Completion means an owner can open a task, chat with the same Nethra that is working on it, see each verified action and next step, leave it running through useful passes, and receive either an evidence-backed result or a specific decision request. A self-improvement task must produce measured evidence and a reviewable code draft before claiming improvement. The current stalled task is a replay case, not proof that the redesigned loop works.
