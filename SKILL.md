---
name: asana
description: when configuring Asana tasks via MCP — read, write, restructure, rename, delete, backup, audit. Multi-task, parallel sub-agents, codebase coordination. Not for non-Asana PM.
---

# GG → Asana → Operations

> **Snapshot age:** live operational guidance (no vendored corpus). The Asana MCP surface evolves; verify tool names with `ToolSearch` before running unfamiliar operations.

## Overview

This skill operates on Asana projects through the Asana MCP server(s). It treats Asana as a managed dataset to be discovered, restructured, mass-edited, audited, deduplicated, and backed up — often coordinated with content read from the local codebase or repository docs.

Two layers:

1. **Tool layer** — how to call `get_task`, `get_tasks`, `update_tasks`, `create_tasks`, `delete_task`, and related MCP tools correctly (parameter quirks, deferred-tool loading, primary-vs-bridge servers).
2. **Operation layer** — recurring patterns of work: discover a project, place prompts on subtasks, mirror prompts to custom fields, rename by pattern, restructure parents into containers + subsections, design meeting-recording questions, audit alignment against an external briefing, snapshot the project to disk before destructive operations.
3. **Routing layer** — when the user explicitly asks for tasks to be iterated, worked, executed, or completed after they are created, route from task creation into artifact production and field updates without waiting for a second instruction.

When work spans more than ~10 tasks, the canonical move is **parallel sub-agent fan-out**: spawn one agent per logical sub-unit (typically one per parent task), have them author content to disk, then push to Asana in a second wave.

## When to Use This Skill

**TRIGGER when:**

- The user mentions an Asana project, task, subtask, custom field, or section
- The task involves discovering project structure, reading task content, or auditing what exists
- Mass-editing tasks: rename by pattern, mirror content into a custom field, populate empty fields, add type prefixes
- Restructuring: split a parent into A/B/C subsections, convert parents into containers, re-parent subtasks
- Creating many subtasks at once with rich content (notes + custom fields)
- Creating tasks/subtasks and then explicitly working, iterating, executing, completing, or saving outputs for those newly created tasks
- Snapshotting the project to disk before any destructive operation
- Auditing project state against an external source-of-truth document (briefing, spec, deliverable rubric)
- Designing meeting-recording or follow-up questions and mirroring them to Asana subtasks

**SKIP when:**

- The user only needs a one-off task fetch with no editing — call the MCP directly without invoking this skill
- The work is purely codebase or git operations with no Asana side
- The user is asking about Asana's web UI workflow, not API/MCP automation

## Common Misconceptions

| # | Misconception | Correction | Key concept |
|---|---|---|---|
| 1 | The Asana MCP tools are always available | They come **deferred**. Schemas must be loaded via `ToolSearch` with `select:<tool-name>` before they can be called | Deferred tool loading |
| 2 | One MCP server is canonical | Many setups expose **two** Asana MCP servers (primary + http-bridge). The primary can return stale/wrong payloads; always verify `response.data.gid == requested_task_id` and fail over to the bridge | Two-server failover |
| 3 | `get_project` and `get_tasks` use the same project-id param | They don't. `get_project` uses `project_id`; `get_tasks` uses `project`. Mixing them up returns `Not a Long: undefined` | Inconsistent param naming |
| 4 | `limit` accepts string values | It must be a **number literal** (`100`, not `"100"`). String values return `Invalid arguments` | Param type enforcement |
| 5 | Custom-field GIDs and task GIDs are interchangeable | They are not. Custom-field GIDs go inside `custom_fields: {<field-GID>: <value>}` on `update_tasks`. Passing them as `task_id` returns `Not a recognized ID` | Distinct namespaces |
| 6 | Backup files preserve everything by default | A single agent backing up 100+ tasks shortcuts under context pressure and writes stubs. Always parallelize: one agent per ~10-15 tasks; commit each file immediately | Parallel snapshot pattern |
| 7 | `create_tasks` doesn't support custom fields | It does. Pass `custom_fields: {<field-GID>: <text-value>}` inside each entry of the `tasks: [...]` array | Custom fields at create time |
| 8 | Deleting subtasks is recoverable via the API | `delete_task` is irreversible at the API layer. Web UI trash retention varies. Always snapshot first | Destructive-op gating |
| 9 | Creating tasks is the end of an Asana authoring request | Only by default. If the user explicitly asks to work/iterate/complete the tasks too, continue into **Create → Work → Save** routing mode and populate the requested output artifacts | Routed execution mode |
| 10 | Runbook is optional | Always maintain asana-operations-runbook.md | Audit trail |

## Non-Negotiable Policy

1. **Snapshot before destructive operations.** Before deleting, mass-restructuring, or wholesale rewriting tasks, run a backup snapshot (see `operations-catalog.md` → Backup project to disk).
2. **Verify returned `gid` matches requested `task_id`** on every `get_task` call. The primary MCP server has shown stale/cross-wired responses; the bridge fallback is more reliable.
3. **Load only the tools you need** via `ToolSearch` `select:` — bulk-loading all Asana tools is wasteful. The minimum kit for most operations is `get_task` + `update_tasks`.
4. **Use `opt_fields` aggressively.** Skip `notes` when you only need names; skip `subtasks.notes` when subtask names suffice. Large responses get spilled to a file and require `jq` to parse.
5. **Parallelize per logical unit.** For 100+ task operations, spawn N sub-agents (one per parent task or one per ~10 tasks). One sequential agent over a large dataset will hit context limits and produce stubs or silent truncation.
6. **Author to disk first, push second.** When authoring content (prompts, briefs, question text), have agents write structured JSON or Markdown to disk, validate with `jq`, then run a separate push wave. This decouples authoring failures from push failures.
7. **Idempotency.** Anthropic API can hit transient internal-server-errors mid-execution. Every operation pattern in this skill must be safe to re-run; agents should inspect current state and skip already-correct tasks.
8. **Maintain a runbook in the working folder.** Every meaningful Asana operation type adds an entry to `<working-folder>/asana-operations-runbook.md` so subsequent sessions can recover the playbook without context-mining.
9. **Do not auto-work created tasks unless explicitly routed.** Creating tasks/subtasks normally stops after creation + verification. Continue into working those tasks only when the user explicitly asks for it, or after creation offer that mode as the next action without starting it.

## Asana Quality Checklist

Use this checklist before and during any Asana operation.

| # | Checklist Item | Why It Matters | Gate |
|---|---------------|---------------|------|
| 1 | **Tool loading verified** — ToolSearch select: ran | Deferred tool loading | Pre-op |
| 2 | **GID verified** — Returned gid == requested task_id | Server reliability | Draft |
| 3 | **Snapshot created** — Backup before destructive ops | Safety | Pre-op |
| 4 | **Param types correct** — Numbers not strings, correct param names | API correctness | Draft |
| 5 | **opt_fields used** — Only fetch needed fields | Performance | Draft |
| 6 | **Parallelization planned** — One agent per ~10-15 tasks | Context limits | Draft |
| 7 | **Authored to disk first** — JSON/MD validated before push | Decoupling | Draft |
| 8 | **Runbook updated** — asana-operations-runbook.md maintained | Audit trail | Closeout |

### Quality Tiers

| Tier | Criteria | Use When |
|------|----------|----------|
| **Minimal** | Items 1-3, 8 | Quick fetch |
| **Standard** | Items 1-6, 8 | Multi-task operation |
| **Full** | All 8 items | Mass edit or restructure |

### Pre-Op Verification

```
□ ToolSearch select: ran for needed tools
□ GID verification understood
□ Snapshot planned before destructive ops
□ Parallelization strategy determined
```

## Asana Consistency Validator

Before finalizing, verify:

### Consistency Check Matrix

| Check | What to Verify | How to Fix |
|-------|---------------|------------|
| **Tool vs Deferred** | ToolSearch ran before calling tools | Add ToolSearch |
| **GID vs Stale** | Returned gid == requested task_id | Failover to bridge |
| **Param vs Type** | Numbers used, correct param names | Fix types |
| **Author vs Push** | Content validated before push | Add validation |

### Red Flags (Never Present)

- [ ] Calling Asana tools without ToolSearch
- [ ] Ignoring returned gid mismatch
- [ ] String values for numeric params
- [ ] Push without disk-first authoring
- [ ] Destructive ops without snapshot

## Routing Modes

### Default mode — Create / update / audit only

Use this mode when the user asks to create, edit, restructure, or audit Asana tasks but does not say
to work the tasks afterward.

Required behavior:

1. author any prompts or task specs to disk first;
2. push the task/subtask/custom-field changes;
3. verify the current Asana state by refetching representative or all changed tasks, depending on
   risk and size;
4. close with a short offer:
   - "I can also work these newly created tasks and save their Output fields if you want."

Do **not** infer that the user wants generated outputs merely because tasks have `Input` fields,
`Artifact` types, or report-style names.

### Explicit mode — Create → Work → Save

Use this routed mode when the user explicitly asks to work, iterate, execute, complete, answer, fill
outputs for, or save outputs for tasks/subtasks. Trigger examples:

- "create these report subtasks and work them"
- "create the tasks, then execute them"
- "iterate the subtasks you create"
- "fill/save the outputs after creating them"
- "work through each created task and write the Output field"

Behavior:

1. **Define the work scope.**
   - If tasks were just created in the same operation, scope to those newly created GIDs by default.
   - If the user points at existing tasks, first inventory the matching tasks and confirm the target
     set in the runbook.
   - Do not include parent tasks or older siblings unless the user explicitly includes them.
2. **Preserve the original create manifest.**
   - Save created task/subtask GIDs, names, parents, inputs, artifact type, and permalink URLs under
     `agent-output/`.
   - This manifest is the routing handoff from creation to work.
3. **Author work artifacts to disk before touching Asana.**
   - For each task, read its `Input`, relevant repository/source evidence, and any task-specific
     custom fields.
   - Write one artifact per task to JSON or Markdown under `agent-output/`.
   - Validate machine-readable output with `jq` or an equivalent parser before update calls.
4. **Save results to the requested field.**
   - For report tasks, the default destination is the `Output` custom field when present.
   - If no destination field is specified and no obvious `Output` field exists, ask before writing
     into notes or comments.
   - Use idempotent writes: skip tasks whose current output already matches the generated artifact;
     pause on non-empty conflicting outputs unless the user explicitly allowed overwrites.
5. **Verify against current Asana state.**
   - Refetch every worked task when the routed set was generated by this operation.
   - Verify output presence, exact output match to the disk artifact, task identity, parent identity,
     artifact type, and any requested status field.
6. **Completion audit is mandatory.**
   - Restate the routed objective as deliverables.
   - Map task-creation, artifact-authoring, Asana-update, and verification requirements to concrete
     files and refetched Asana evidence.
   - Do not declare completion from create/update success alone; the current Asana state must match
     the artifact manifest.

### Offer-after-create behavior

After creating tasks/subtasks with rich `Input` prompts or `Artifact` fields, proactively offer the
routed mode as a next step:

> "Created and verified the tasks. If you want, I can now run Create → Work → Save mode: work each
> created task from its Input and save the result into its Output field."

This is an offer, not implicit permission. Start the routed mode only after the user accepts or when
the original request already included explicit work/iterate/execute language.

## Quick Commands

### Load the tools you need

```text
# Common minimal kit
ToolSearch select:mcp__<server>__get_task,mcp__<server>__update_tasks

# When discovering a new project
ToolSearch select:mcp__<server>__get_me,mcp__<server>__get_projects,mcp__<server>__get_project,mcp__<server>__get_tasks

# When creating subtasks
ToolSearch select:mcp__<server>__create_tasks

# When deleting
ToolSearch select:mcp__<server>__delete_task
```

Replace `<server>` with the project's actual MCP server name (often a UUID prefix). Both `primary` and `http-bridge` Asana servers may be available — load the bridge as a fallback when the primary returns stale data.

### Discover project

```text
get_me()
get_projects(limit=100)
get_project(project_id="<GID>", include_sections=true)
get_tasks(project="<GID>", limit=100, opt_fields="name,completed,due_on,assignee.name")
```

### Read parent + subtasks deeply

```text
get_task(
  task_id="<parent-GID>",
  include_subtasks=true,
  include_comments=false,
  opt_fields="name,notes,subtasks.gid,subtasks.name,subtasks.notes,custom_fields.gid,custom_fields.text_value,custom_fields.name,subtasks.custom_fields.gid,subtasks.custom_fields.text_value,subtasks.custom_fields.name"
)
```

### Batch updates

```text
update_tasks(tasks=[
  {"task": "<GID>", "notes": "<new>"},
  {"task": "<GID>", "name": "<new>", "custom_fields": {"<field-GID>": "<value>"}},
  ...
])
# up to 50 entries per call
```

### Batch creates

```text
create_tasks(tasks=[
  {
    "name": "...",
    "workspace": "<workspace-GID>",
    "projects": [{"project_id": "<project-GID>", "section_id": "<optional-section-GID>"}],
    "notes": "...",
    "custom_fields": {"<field-GID>": "..."}
  },
  ...
])
# Subtasks: pass `parent: "<parent-GID>"` instead of `projects` (project membership inherited).
```

### Move task to a section within an existing project

```text
update_tasks(tasks=[{
  "task": "<GID>",
  "add_projects": [{"project_id": "<project-GID>", "section_id": "<section-GID>"}]
}])
# Asana re-places the task in the new section if it's already in the project.
```

### TypeScript scripts (REST fallback for missing MCP coverage)

For section CRUD and a few other surfaces the MCP server does not expose, use the wrappers under `scripts/`. They load `ASANA_PAT` + default GIDs from `.env` via Node 20.6+ `--env-file`. See `scripts/README.md` for the full list.

```bash
# From scripts/ — first time only
npm install

# Create a section in the default project
npx tsx --env-file=../.env create-section.ts "<section name>"

# List sections (table or JSON)
npx tsx --env-file=../.env list-sections.ts
npx tsx --env-file=../.env list-sections.ts --json

# Move N tasks into a section
npx tsx --env-file=../.env move-tasks-to-section.ts \
    --section <section-GID> \
    <task-GID-1> <task-GID-2>

# Snapshot the project's section / task / subtask tree to markdown
npx tsx --env-file=../.env get-project-inventory.ts --output /tmp/inventory.md

# Wire dependencies for one parent per the Research→Visuals→Video→Deliverable DAG
npx tsx --env-file=../.env set-task-dependencies.ts --parent <parent-GID> --dry-run

# List attachments on a task (table or JSON)
npx tsx --env-file=../.env list-attachments.ts --task <task-GID>
npx tsx --env-file=../.env list-attachments.ts --task <task-GID> --json

# Upload a local file as a task attachment (REST — no MCP equivalent)
npx tsx --env-file=../.env upload-attachment.ts \
    --task <task-GID> \
    --name "<display name>" \
    --type application/json \
    --skip-if-exists \
    /local/path/to/file.json

# Delete attachments by GID (REST — no MCP equivalent)
npx tsx --env-file=../.env delete-attachment.ts <attachment-GID-1> <attachment-GID-2>
```

Section management and attachment **writes** are the headline gaps — the primary MCP server has no `create_section` / `update_section` / `delete_section` / `list_sections`, and no upload or delete tool for attachments (it only exposes `get_attachments`). REST is the only path for those surfaces. See `references/operations-catalog.md` → "Create / inspect / move sections" (#18) and "Manage task attachments (upload / list / delete via REST)" (#19), plus `references/tools-cheatsheet.md` → "REST fallback for missing MCP coverage" for the gotcha catalog.

## Workflow

Pick the operation, then read the matching reference file before acting.

| Goal | Reference |
|---|---|
| Map an unfamiliar project | `operations-catalog.md` → Discover project |
| Mass-edit tasks (notes, names, custom fields) | `operations-catalog.md` → Mass-edit / Rename / Mirror to custom field |
| Author content with parallel sub-agents | `parallel-agent-patterns.md` |
| Restructure a single-question parent into A/B/C container | `operations-catalog.md` → Expand & reorganize |
| Snapshot the project to disk | `operations-catalog.md` → Backup project to disk |
| Audit alignment against an external briefing | `operations-catalog.md` → Audit project against external spec |
| Look up a tool's exact parameter shape | `tools-cheatsheet.md` |
| Get a one-liner for a common operation | `quick-reference.md` |

### The canonical fan-out shape

For any operation spanning more than ~10 tasks:

1. **Write a shared spec to disk first** (e.g. `agent-output/SPEC.md`) so every parallel agent reads the same contract.
2. **Spawn N agents in one message.** Each agent loads only the MCP tools it needs, fetches its assigned slice, authors content, writes JSON or Markdown to disk.
3. **Validate the JSON** with `jq` on every output file before the push wave.
4. **Spawn N small worker agents** in a second wave. Each reads its sibling's JSON and calls `update_tasks` (or `create_tasks` / `delete_task`) in one batch.
5. **Spot-fetch 2-3 tasks** post-wave to verify writes landed (the primary MCP's stale-response bug means "succeeded" responses sometimes return data for different GIDs — the writes themselves usually work, but verify).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Not a Long: undefined` on `get_project` | Used `project` param instead of `project_id` | Use `project_id`. The two params differ between `get_project` and `get_tasks` |
| `Invalid arguments for tool ... "limit": Expected number, received string` | Passed `limit: "100"` | Pass `limit: 100` (numeric literal) |
| `get_task` returns a `data.gid` that doesn't match `task_id` | Primary MCP stale/cross-wired response | Retry; if persistent, fall back to the http-bridge MCP variant for that fetch |
| Response too large, spilled to file | `notes` or full subtree fetched in one shot | Use `opt_fields` to skip `notes`, or page with smaller `limit`. Read the spilled file with `jq` |
| Backup median file size ~600 bytes per task | Single agent shortcutted under context pressure | Re-run with N parallel agents (one per ~10 tasks). Each agent must `Write` each file immediately, not accumulate in context |
| `Not a recognized ID` on `get_task` | Custom-field GID passed as `task_id` | Custom-field GIDs go inside `custom_fields: {<field-GID>: <value>}` on `update_tasks`, never as `task_id` |
| `create_tasks` claims success but tasks not visible | First call returned a stale response payload from a prior operation | Retry the same `create_tasks` call; the second usually returns the real data. Verify by re-fetching one of the returned GIDs |
| `update_tasks` response data field shows unrelated GIDs | Same stale-response bug, cosmetic only | The `failed: []` and `summary` fields are trustworthy; the `data` array can be misleading. Re-fetch one task to confirm |

## Common Pitfalls

1. **Treating both MCP servers as equivalent.** The primary often has a stale/cross-wired response bug; the bridge is the reliable failover. Load both, prefer primary, retry on bridge.
2. **Calling `delete_task` without a snapshot.** Web UI trash retention is finite and the API can't recover. Always run the backup pattern first; keep the deletion list as a revert manifest.
3. **Bulk-loading every Asana tool via `ToolSearch`.** Each select is one round-trip; load only what the current operation needs.
4. **Embedding `subtasks.custom_fields.text_value` in a deep parent fetch.** This projection has shown lossy behavior when the parent response is large. Fetch subtasks individually for full-fidelity text values.
5. **Skipping idempotency checks in re-runs.** When an agent fails mid-execution (transient API error, context overflow), the next run must inspect current state and skip already-correct tasks. Otherwise you double-edit or create duplicates.
6. **Forgetting that subtasks are not sectioned independently.** Subtasks inherit visibility via their parent task. Don't pass `section_id` when creating subtasks; pass `parent` instead.
7. **Mass-edits without per-operation reports.** Each batched `update_tasks` should produce a per-task report (GID + old → new) saved to disk. Otherwise revert is impossible.

## Cross-Skill Coordination

### Use together with

- The codebase / file-reading tools when Asana content must reflect what's in the repo (e.g. authoring prompts that reference real component names, generating per-Q briefs from a briefing document in `.tmp/`).
- A research / WebSearch skill when verifying provider-side capability before claiming it in task notes.

### Blocking gates

1. Do not run destructive operations (delete, mass-rewrite) until a backup snapshot exists in the working folder.
2. Do not push agent-authored content to Asana until `jq` validates every output JSON file.
3. Do not consider a multi-wave operation complete without spot-verifying 2-3 tasks via fresh `get_task` calls.

## Working Folder Convention

Each significant project should have a working folder at `.tmp/<YYYY-MM-DD-HHMM>-<topic>/` containing:

- `asana-mcp-playbook.md` — tool-layer reference (params, GIDs, gotchas captured during this engagement)
- `asana-operations-runbook.md` — operation-layer playbook (one entry per type of operation performed)
- `agent-output/` — JSON outputs from authoring agents, shared specs
- `backup/<YYYY-MM-DD>-snapshot/` — full per-task Markdown backups
- `audit-reports/` — alignment audits against external sources of truth

Update the runbook after every meaningful operation; future sessions recover the playbook from these files without re-discovery.

## Local Corpus Layout

The `references/` directory contains **4 hand-authored files** (no subfolders):

- `quick-reference.md` — most common commands in one place
- `tools-cheatsheet.md` — exhaustive MCP tool surface with parameter shapes and gotchas
- `operations-catalog.md` — patterns of work: discover, mass-edit, restructure, snapshot, audit, dedup
- `parallel-agent-patterns.md` — sub-agent fan-out strategies, shared specs, two-wave authoring/pushing
