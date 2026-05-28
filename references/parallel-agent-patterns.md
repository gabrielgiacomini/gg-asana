---
title: Asana MCP — Parallel Sub-Agent Patterns
---

# Asana MCP — Parallel Sub-Agent Patterns

How to fan out Asana work across multiple sub-agents safely. Covers shared specs, two-wave authoring/pushing, idempotency, response-quirk handling, and convention-drift mitigation.

For operation-level recipes see `operations-catalog.md`. For tool details see `tools-cheatsheet.md`.

---

## When to fan out

Use parallel sub-agents when:

- The operation spans **more than ~10 logical units** (parents, subtasks, sections)
- Each unit is **independent** — no cross-unit ordering needed
- Each unit needs **substantial authoring** (≥ 1000 chars output per task) — keeping it all in the parent agent's context wastes tokens and risks context overflow
- **Time matters** — N parallel agents finish in roughly the time of one agent

Use a single agent when:

- The operation is ≤ ~10 tasks total
- The operation is mechanical (pattern substitution, batched delete) — no per-unit reasoning needed
- The operation requires cross-unit state (e.g. a global tally, deduplication across all tasks)

---

## The canonical fan-out shape

**Two waves:**

1. **Authoring wave** — N agents author content to disk
2. **Pushing wave** — N agents read the authored content and push to Asana

Separating concerns means:

- Authoring failures don't block the push
- Push failures can be retried without re-authoring
- The disk artifacts let humans inspect/edit before applying
- Parent agent's context stays clean — it only sees short confirmation reports

```
┌────────────────┐           ┌────────────────┐
│  Parent agent  │           │  Disk          │
│                │           │                │
│  1. Write SPEC ├──────────►│  SPEC.md       │
│                │           │                │
│  2. Spawn N    │           │                │
│     authors    │   ┌─────► │  unit-1.json   │
│                │   │       │  unit-2.json   │
│                │   │       │  ...           │
│                │   │       │                │
│  3. jq         │   │       │                │
│     validate ──┼───┘       │                │
│                │           │                │
│  4. Spawn N    │           │                │
│     pushers ───┼──────────►│  (reads JSON)  │
│                │           │                │
│  5. Spot-      │           │                │
│     verify     │           │                │
└────────────────┘           └────────────────┘
```

---

## Step-by-step

### Step 1 — Write the shared spec

Before spawning any agents, write a SPEC file to disk. This is the **single source of truth** for the operation. Convention drift across N parallel agents is the biggest failure mode; the SPEC eliminates it.

`<working-folder>/agent-output/SPEC.md`:

```markdown
# Authoring Spec — <operation name>

## Project context
- Asana project: <GID>
- Workspace: <GID>
- Due date / scope: <…>

## Required structure
<exact format expected on Asana — notes structure, IN value shape, naming convention>

## Style rules
<plain-English first, technical names in parens, no leading type labels, no exact timings, etc.>

## Per-unit content rules
<how to derive content from the source — briefing path, codebase paths, etc.>

## Output format
<exact JSON or markdown shape each agent should write>

## Naming convention
<task name pattern>
```

Reference this SPEC file by absolute path in every agent prompt. **Never restate the SPEC in agent prompts** — that's how drift happens.

---

### Step 2 — Spawn the authoring wave

In ONE message, spawn all N agents in parallel. Each prompt should:

1. State the agent's scope (which parent/slice it handles)
2. Reference the SPEC file path
3. List the GIDs the agent is responsible for
4. State explicit anti-drift instructions: "Read the SPEC before designing anything. If your existing sibling folders already follow a convention, match it; don't restate from the SPEC if reality has diverged."
5. State the output disk path (`agent-output/<unit>.json`)
6. State that the agent should NOT modify Asana directly — only write disk

**Per-agent prompt skeleton:**

```text
You are the <operation> agent for <unit>.

READ FIRST: <absolute path to SPEC.md>

YOUR PARENT TASK:
- <unit name>
- Parent GID: <GID>

STEPS:
1. Load Asana MCP get_task via ToolSearch (primary; bridge fallback if stale)
2. Fetch your parent + subtasks
3. Author content per the SPEC
4. Write your output JSON to: <absolute path>/agent-output/<unit>.json
5. Return one line: "<unit>: <count> tasks written"

DO NOT modify Asana. Author content only.
```

**Run agents in background** when launching many in parallel — let them work independently.

---

### Step 3 — Validate JSON before pushing

Don't push agent outputs without validation. Run `jq` over every output file:

```bash
cd <working-folder>/agent-output
for f in *.json; do
  count=$(jq 'length' "$f" 2>/dev/null)
  fields_ok=$(jq 'all(.[]; has("task") and has("notes"))' "$f" 2>/dev/null)
  size=$(wc -c < "$f" | tr -d ' ')
  echo "$f: $count tasks, fields_ok=$fields_ok, ${size}b"
done
```

If any file shows `fields_ok=false` or unexpectedly small size, re-run the affected agent before proceeding.

---

### Step 4 — Spawn the pushing wave

In a second message, spawn N small worker agents in parallel. Each:

1. Reads its `<unit>.json`
2. Loads `update_tasks` (or `create_tasks` / `delete_task`)
3. Sends one batched call with all entries from the JSON
4. Reports success/failure count

**Per-worker prompt skeleton (~10 lines, much smaller than authoring agents):**

```text
Push <unit> task content from disk to Asana.

1. Read <absolute path>/agent-output/<unit>.json
   (JSON array of {task, notes, prompt} entries, ~N entries)

2. Load Asana update_tasks via ToolSearch:
   select:mcp__<server>__update_tasks

3. Construct one update_tasks call: for each entry,
   {task: entry.task, notes: entry.notes, custom_fields: {"<IN-GID>": entry.prompt}}

4. Send. Report: "<unit>: updated N of M tasks (failures: <list or 'none'>)"
```

---

### Step 5 — Spot-verify

Re-fetch 2-3 tasks across different units via `get_task`. Confirm:

- `notes` match what was authored
- `custom_fields.<field-GID>.text_value` is set correctly
- `name` is correct (if renames were part of the push)

This catches the **stale-response bug**: `update_tasks` sometimes returns the wrong `data` payload even though the writes succeeded. Spot-verification confirms ground truth.

---

## Idempotency

Agents will sometimes fail mid-execution (Anthropic API internal errors, context overflow, transient MCP issues). The retry must be **safe**: re-running an agent should produce the same result, not duplicates or double-edits.

**Per-agent idempotency rules:**

1. **Inspect current state first.** Fetch each task's current `notes` / `custom_fields` / `name`. If already in target form, skip.
2. **Track applied changes on disk.** After each successful push, log `<GID> → <new value>` to a `placements.md` or `applied.md` file. Subsequent runs read this log and skip already-applied entries.
3. **Make naming changes idempotent.** Pattern-based renames (e.g. `<prefix>S. ...` → `<prefix>.S ...`) should detect the target pattern and skip if matched.

---

## Convention-drift mitigation

The biggest failure mode in parallel fan-out is N agents producing N slightly-different conventions.

**Mitigations:**

1. **Reference a SPEC file** in every agent prompt. Don't paste rules into prompts.
2. **State explicit defer-to-reality instructions.** "If your existing sibling folders use a different convention than the SPEC, match the sibling folders and flag the drift in your report."
3. **Verify-before-write step.** Each agent should list its target folder's existing files / sibling tasks BEFORE designing new ones. Detect drift early.
4. **Final aggregator pass.** After all parallel agents land, spawn one normalization agent that:
   - Lists every artifact across all units
   - Detects any name/format inconsistencies
   - Renames / reformats divergent entries to match the canonical convention
   - Reports the rename map

This aggregator is cheap (one agent, ≤ 50 renames in one `update_tasks` call) and catches drift that slipped through.

---

## Stale-response handling

Both Asana MCP servers (primary and http-bridge) have shown a stale-response bug where:

- `get_task` returns a `data.gid` that doesn't match the requested `task_id`
- `update_tasks` / `create_tasks` `data` field contains payloads from unrelated prior operations

**Handling rules:**

1. **For reads:** verify `response.data.gid == requested_task_id` after every `get_task`. Retry on mismatch. If repeated, switch to the fallback MCP server variant.
2. **For writes:** check the `failed: []` and `summary` fields (those are trustworthy). The writes themselves usually succeed even when the `data` field is wrong. Spot-fetch one of the written tasks to confirm.
3. **Document the quirk** in every agent prompt: "If a get_task response's data.gid doesn't match your requested task_id, retry; if persistent, fall back to the bridge variant."

---

## Background vs foreground agents

When spawning N agents, the parent runtime can run them in **background** (the parent doesn't wait) or **foreground** (the parent blocks until each finishes).

**Background** is the default for fan-out:

- Spawn all N at once in a single parent message
- Each agent reports completion asynchronously
- Parent can do other work in the meantime
- Useful when N is large (10+) and each agent takes significant time

**Foreground** is appropriate for:

- Small N (≤ 3) where you want sequential confirmation
- Operations where the next step depends on the agent's specific output
- Quick fix-up agents that finish in seconds

---

## Anti-patterns

1. **One sequential agent for 100+ tasks.** Symptom: median output file size is ~600 bytes per task; backups are full of stubs. Fix: re-run with N parallel agents.
2. **Pasting the SPEC into every agent prompt.** Symptom: agents diverge on small details, naming forks emerge, normalization pass becomes expensive. Fix: reference SPEC by path; never inline.
3. **Skipping JSON validation between waves.** Symptom: pushing wave fails on malformed JSON, partial pushes leave Asana in inconsistent state. Fix: always `jq` between waves.
4. **No spot-verification.** Symptom: agents report success, but Asana writes silently failed (or written to wrong GIDs). Fix: fetch 2-3 tasks post-operation and confirm.
5. **Pasting the briefing into every agent prompt.** Symptom: long agent prompts, redundant context. Fix: tell agents to `Read` the briefing file path themselves; only the per-agent scope (parent GID, section to focus on) goes inline.
6. **Per-agent idempotency forgotten.** Symptom: retries double-edit tasks or create duplicates. Fix: every agent reads current state before writing; skips already-correct entries.
