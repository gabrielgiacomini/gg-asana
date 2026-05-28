---
title: Asana MCP — Operations Catalog
---

# Asana MCP — Operations Catalog

Recurring operation patterns for Asana project management via MCP. Each entry is self-contained: when to use, tools needed, sequential steps, gotchas, verification, and revert.

For one-off command syntax see `quick-reference.md`. For tool details see `tools-cheatsheet.md`. For sub-agent fan-out details see `parallel-agent-patterns.md`.

---

## 1. Discover project

Get the lay of the land for an unfamiliar project.

**Tools:** `get_me`, `get_projects`, `get_project`, `get_tasks`, `get_task`

**Pattern:** sequential — each step depends on the previous

**Steps:**

1. `get_me()` — confirms auth, returns workspace GID
2. `get_projects(limit=100)` — lists projects; capture GIDs
3. `get_project(project_id="<GID>", include_sections=true)` — sections, custom-field schema, members, owner. **Note the parameter is `project_id`**
4. `get_tasks(project="<GID>", limit=100, opt_fields="name,completed,due_on,assignee.name")` — top-level tasks. **Skip `notes`** in opt_fields or the response can overflow the token budget. **`limit` must be a number literal**
5. For interesting parents, `get_task(task_id="<GID>", include_subtasks=true, opt_fields="...")` in parallel

**Gotchas:**

- `get_tasks` with `notes` opt_fields can exceed token budget; the response is spilled to a file. Read with `jq` rather than `cat`
- `opt_fields` supports dot-notation (`assignee.name`, `subtasks.notes`, `custom_fields.text_value`)

**Verify:** returned task count matches `get_project.task_counts.num_tasks`

---

## 2. Place existing prompts on subtasks

Parent task's `notes` contains labeled code blocks (e.g. "Codebase Prompt", "Infographic Prompts"). Each block belongs on a matching subtask.

**Tools:** `get_task`, `update_tasks`

**Pattern:** read parent in context, batch updates per parent (≤ 50 subtask updates per call)

**Steps:**

1. Read each parent's `notes` (already in context if discovery just ran)
2. Map each code block to the matching subtask by name pattern:
   - Investigation/research blocks → "Analyze the codebase…" / "Research…" subtask
   - Per-artifact blocks (e.g. "Infographic N") → matching "Design Infographic N…" subtask
   - Script blocks → matching "Write video script…" subtask
3. Send `update_tasks` per parent with `{task, notes}` for each subtask receiving a prompt

**Gotchas:**

- Code blocks often have labeled headers outside the fence (e.g. `**Infographic Prompts:**`) — extract just the fenced content
- Some Qs have wrapper subtasks ("Create five infographics covering…") that should hold *concatenated* prompts; others have per-item subtasks for 1:1 placement. Inspect actual subtask names per parent

**Verify:** spot-fetch one subtask per parent; confirm `notes` contains the placed prompt

**Revert:** `update_tasks` with `notes: ""` for the placed subtask. Original content is still in the parent's `notes` (don't touch parent during placement)

---

## 3. Mirror prompts to a text custom field

For each task with content in `notes`, the same content also goes into a text custom field (e.g. an `IN` field used for downstream automation).

**Tools:** `update_tasks` (custom_fields key)

**Pattern:** two batched calls (≤ 50 tasks each)

**Steps:**

1. Determine the target field GID via `get_project(include_sections=false)` and inspect `custom_field_settings[].custom_field`
2. Have each task's prompt text in hand (from authoring or from re-fetching `notes`)
3. Send `update_tasks` with `custom_fields: {"<field-GID>": "<prompt text>"}` per task

**Schema reminder:**

```json
{"task": "<GID>", "custom_fields": {"<field-GID>": "<value>"}}
```

For enum-type fields, the value is the option GID, not the display name. For text fields, the value is a plain string.

**Verify:** `get_task(opt_fields="custom_fields.gid,custom_fields.text_value,custom_fields.name")` and inspect

---

## 4. Author content with parallel sub-agents

When new content needs authoring per-task (Goal+Context+Prompt block, master synthesis prompt, briefing-derived briefs), don't do it in the parent context — fan out.

**Pattern:** two waves — N authoring agents → N pushing agents

See `parallel-agent-patterns.md` for the full pattern. Key points:

1. Write a shared `SPEC.md` to disk describing structure, style, rules, exemplar, output format
2. Spawn N agents in one message. Each: reads spec, fetches its slice, authors, writes JSON to disk
3. Validate every JSON file with `jq`
4. Spawn N worker agents in a second wave to push to Asana via `update_tasks`

---

## 5. Rename tasks by pattern

Two common cases:

**(a) Semantic rename per parent** — each agent classifies its subtask types and renames (e.g. `<prefix>.S Research:` / `<prefix>.S Diagram 1:` / `<prefix>.S Script:`). Use N parallel agents because the type classification needs context.

**(b) Mechanical pattern rename** — regex-style substitution (e.g. `1.` → `<prefix>01.`). Use one sequential agent.

**Tools:** `get_task` (fetch names), `update_tasks` (set `name`)

**Steps (mechanical):**

1. Define the rename rule as a substitution table
2. Agent fetches all task + subtask names with `get_task(include_subtasks=true, opt_fields="name,subtasks.name")`
3. Compute new name per task; skip if already in target form (idempotency)
4. Batch `update_tasks` calls (≤ 50) with `{task, name}` per renamed task

**Gotchas:**

- Source data may have casing inconsistencies (e.g. `9a` / `9A` coexist). Normalize when you can
- Separators after the prefix can vary (`1S. ` vs `9A.S `). Decide on canonical form before renaming
- `update_tasks` only updates the fields you pass — sending `{task, name}` doesn't touch `notes` or `custom_fields`

**Verify:** re-fetch a sample of renamed tasks; confirm names match the target pattern

---

## 6. Delete tasks

Used to remove duplicate or obsolete tasks. **Destructive.**

**Tools:** `delete_task` (one task per call, no batch API)

**Pattern:** one agent finds target GIDs by name pattern, then deletes them in sequence

**Steps:**

1. **Snapshot first** — see operation 9 below
2. Agent fetches relevant parents with `get_task(include_subtasks=true, opt_fields="subtasks.name")`
3. Agent collects every subtask GID whose name matches the target pattern
4. **Print the deletion list before executing** — GID + name + parent. Inspect for false positives
5. Loop `delete_task(task=<GID>)`. Each returns `{"data": {}}` on success
6. Report list of deleted GIDs in a table

**Gotchas:**

- `delete_task` is **irreversible** via the API. Asana web UI can recover within ~30 days but not via API
- Subtasks of the deleted task are also deleted unless they're shared with another project
- No batch API — N calls means N round-trips

**Verify:** re-fetch each parent's subtask list; the targeted names should be gone

**Revert:** within retention window, restore from Asana web UI trash. Otherwise, recreate from backup snapshot

---

## 7. Restructure existing notes (prepend Goal+Context)

Add a structured `**Goal:** / **Context:** / --- / <existing prompt>` block to subtasks that previously held only the bare prompt.

**Tools:** `get_task`, `update_tasks`

**Pattern:** N parallel sub-agents (Goal/Role lines are per-Q specific)

**Steps:**

1. Spawn one agent per parent task
2. Each agent fetches its parent + subtasks, then for each subtask:
   - Reads current `notes` (which holds the placed prompt)
   - Composes `**Goal:** <one line>\n\n**Context:**\n- **Project:** …\n- **Parent question:** …\n- **Role:** …\n\n---\n\n<original prompt verbatim>`
   - Sends `update_tasks` with the new `notes`
3. Optionally also sync the same prompt to the IN custom field (operation 3)

**Gotchas:**

- Preserve the original prompt verbatim below `---`. Don't paraphrase
- Keep IN custom field aligned if the project uses it as a downstream signal

---

## 8. Expand & reorganize (split a parent into A/B/C subsections)

Convert a single-topic parent (e.g. `X. <topic>`) into a container header pointing to new sub-topic parents (`X-A`, `X-B`). The existing subtasks under `X` are now orphaned topically and need decommissioning or re-parenting.

**Tools:** `update_tasks`, `create_tasks`

**Pattern:** N parallel expansion agents — each turns one single-topic parent into a container and creates 2-3 children

**Prerequisites:** complete backup snapshot (operation 9)

**Steps:**

1. **Update the existing parent** to be a container:
   - Rename if needed
   - Replace `notes` with a short pointer (e.g. "This is a container; see X-A and X-B for primary work")
   - Clear any long-text custom field that referenced the prior single-topic scope (or set to a short pointer)
2. **Create the new sub-topic parents** via `create_tasks`:
   ```json
   {
     "name": "X-A. <subsection title>",
     "workspace": "<workspace-GID>",
     "projects": [{"project_id": "<project-GID>"}],
     "notes": "<Summary + Deliverable + Audience + --- + master brief>",
     "custom_fields": {"<long-text-field-GID>": "<master brief>"}
   }
   ```
3. **Section-place the new parents** to match the original's section (operation 10)

**Decision: what to do with the existing subtasks under the container?**

- **Decommission** if the subtasks were authored for the single-question version and are now superseded by new A/B/C subtask trees (most common; recommended after running an alignment audit)
- **Re-parent** if individual subtasks cleanly map to one subsection (rare; per-subtask judgment)

**Gotchas:**

- `create_tasks` accepts `custom_fields` at creation time. Many agents incorrectly skip it; verify
- The container parent's existing subtasks remain parented to it — they don't auto-move

---

## 9. Backup project to disk

Snapshot every task's full content as Markdown files so any destructive operation can be reverted.

**Tools:** `get_tasks`, `get_task` (with rich opt_fields), `Write`

**Pattern:** **N parallel agents, each scoped to one parent + its subtasks** (~10-15 tasks per agent). One sequential agent over 100+ tasks **does not work** — it shortcuts under context pressure and writes stubs.

**Output:** `<working-folder>/backup/<YYYY-MM-DD>-snapshot/<gid>.md` + `INDEX.md`

**Steps (per-agent, parallel):**

1. Agent creates the snapshot folder (idempotent: `mkdir -p`)
2. Agent fetches its parent's subtask GIDs: `get_task(task_id="<parent>", include_subtasks=true, opt_fields="subtasks.gid")`
3. For each task (parent + every subtask), fetch INDIVIDUALLY with rich opt_fields:
   ```text
   get_task(task_id="<gid>", include_subtasks=false, include_comments=false,
     opt_fields="name,notes,due_on,completed,assignee.name,parent.gid,parent.name,permalink_url,
                 custom_fields.gid,custom_fields.name,custom_fields.type,
                 custom_fields.text_value,custom_fields.display_value,custom_fields.enum_value.name")
   ```
   **Not** as part of a `subtasks.*` parent projection — long text values get silently truncated
4. Write each MD file via `Write` **immediately** after fetching that task — don't accumulate content in agent context
5. After parent-tree agents finish, a separate agent walks "Other top-level" tasks (non-question parents) and writes them
6. Final agent writes `INDEX.md` with hierarchical TOC

**File format (per task):**

```markdown
# <name>

- **GID:** <gid>
- **Parent GID:** <parent.gid> ("<parent.name>") | "(top-level)"
- **Due:** <due_on or "none">
- **Completed:** <true/false>
- **Assignee:** <assignee.name or "unassigned">
- **Permalink:** <permalink_url>

## Custom Fields

| Field | Value |
|---|---|
| <short fields> | <value or "(empty)"> |
| <long-text field> | _(see below)_ |

### <long-text field>

```
<full text_value verbatim>
```

## Notes

<full notes verbatim — all line breaks preserved>
```

For long-text custom fields, use fenced code blocks below the table to avoid breaking markdown rendering.

**Gotchas:**

- **One agent for many tasks shortcuts under context pressure.** Symptom: `wc -c <gid>.md` returns ~600 bytes for tasks that should be ~3-5 KB. Detect by sampling file sizes
- **Don't rely on `subtasks.custom_fields.text_value`** in deep parent fetches — projection can silently lose data. Per-task `get_task` is more reliable

**Verify:**

1. `ls <backup-folder> | wc -l` — count of files = total task count + 1 (for INDEX.md)
2. `for f in *.md; do wc -c "$f"; done | sort -n | head -10` — smallest files. If many are < 1 KB, the backup is incomplete
3. Spot-fetch one parent and one subtask from Asana; diff against the backup MD

**Use after destructive ops:** to restore a clobbered task, `update_tasks` with notes + custom_fields from the backup MD. For a deleted task, `create_tasks` with the captured fields.

---

## 10. Move tasks between project sections

Place tasks into specific sections within a project — or relocate them. Used after creating new top-level tasks that should match an anchor task's section.

**Tools:** `get_task` (read `memberships`), `update_tasks` with `add_projects`

**Pattern:** one agent reads the target section for each anchor, then batches the moves

**Steps:**

1. Load `get_task` and `update_tasks`
2. For each anchor task whose section you want to mirror:
   ```text
   get_task(task_id="<anchor>", opt_fields="memberships.project.gid,memberships.section.gid,memberships.section.name")
   ```
   Find the entry where `project.gid` matches the target project. Capture `section.gid`.
3. To place a task into a section within an existing project:
   ```json
   {"task": "<GID>", "add_projects": [{"project_id": "<project-GID>", "section_id": "<section-GID>"}]}
   ```
4. Batch up to 50 moves per `update_tasks` call

**Gotchas:**

- `memberships.section.gid` is the right opt_fields path (not `section_memberships.*`)
- Section placement is per-project; a task in multiple projects has separate section state per project
- `assignee_section` is a different field — it controls the user's My Tasks view, not the project section

**Verify:** re-fetch a moved task with `opt_fields="memberships.section.gid"`; confirm the section GID matches the target

**Revert:** `update_tasks` with `add_projects: [{project_id, section_id: <original>}]`

---

## 11. Create subtasks under existing parents

Bulk-create new subtasks under existing parent tasks, with full content (name + notes + custom_fields) populated at create time.

**Tools:** `create_tasks` (batch ≤ 50)

**Pattern:** one agent per parent (parallel) — each designs an appropriate subtask set, then sends one batched call

**Steps:**

1. Load `create_tasks` via ToolSearch
2. Per parent, design 4-6 subtasks appropriate to its scope
3. Send ONE batched `create_tasks` call. Each entry:
   ```json
   {
     "name": "<subtask name>",
     "parent": "<parent-GID>",
     "workspace": "<workspace-GID>",
     "notes": "<Goal + Context + --- + Prompt>",
     "custom_fields": {"<field-GID>": "<value>"}
   }
   ```
   No `projects` array needed for subtasks — project membership inherited via `parent`. No `section_id` — subtasks aren't sectioned independently

**Gotchas:**

- **`create_tasks` DOES support `custom_fields`.** Agents sometimes claim there's a single-line limit on text fields (false) or skip `custom_fields` entirely. Explicitly state in agent prompts: "field GIDs go inside `custom_fields: {<field-GID>: <text-value>}` inside each `tasks: [...]` entry. Text fields accept multi-paragraph content."
- **Don't pass `default_assignee: <field-GID>`** — that expects a user GID, not a custom-field GID

**Verify:** spot-fetch 2-3 created subtasks; confirm parent linkage + content

**Revert:** `delete_task` per created GID. Keep the agent's report (full GID list) as the revert manifest

---

## 12. Audit project against external spec

Verify task names and content match an external source-of-truth document (briefing, deliverable rubric, version-controlled spec).

**Tools:** `get_task` (read-only), `Read` (briefing file), `Write` (audit report)

**Pattern:** N parallel audit agents (one per parent or per logical slice). Read-only — no Asana modifications

**Steps:**

1. Write `audit-reports/AUDIT-SPEC.md` describing the criteria, severity levels (✓ aligned / ⚠ minor / ✗ major), and output format
2. Spawn N audit agents in parallel. Each:
   - Reads the spec + the briefing
   - Fetches its parent + subtasks
   - For each task: compares name/notes/custom_fields against briefing's per-section guidance
   - Writes findings to `audit-reports/<slice>.md`
3. After all land, write an aggregate report (manually or via a final aggregator agent) summarizing patterns and recommended remediation

**Severity guidance:**

- **✓ aligned** — no changes needed
- **⚠ minor** — style polish (add tags, swap deprecated names, slightly shorten)
- **✗ major** — content scope mismatch (subtask describes phase the spec reorganized away; subtask should be re-parented; subtask references artifact no longer in scope)

**Don't fix — just audit.** The user reviews and decides remediation.

---

## 13. Design + create meeting-recording / follow-up questions

Generate questions to ask of an internal data source (meeting recordings, support tickets, retros, etc.), surfacing human perspectives that complement codebase-evidenced analysis.

**Tools:** `Write` (markdown), `create_tasks` (Asana subtasks), optionally `update_tasks` for post-create GID-patching

**Pattern:** N parallel agents (one per Q-parent that needs questions) — each designs 3-8 questions, writes one markdown file per question, batches a single `create_tasks` call

**Output (two-layer):**

- **Disk:** `meeting-questions/Q<X>/0N-<slug>.md`
- **Asana:** subtask under the Q parent, mirroring the markdown content

**Steps:**

1. Establish a shared `QUESTION-SPEC.md` describing file format, naming convention, IN-field policy. **Make this canonical** before spawning agents — convention drift across agents is the biggest risk
2. Each agent: reads the briefing for its Q + the spec, designs questions, writes one markdown file per question, sends ONE batched `create_tasks` call
3. After Asana creates subtasks, the agent patches each markdown header with the new GID + permalink

**Markdown file format (canonical):**

```markdown
# <Question>

**Asana subtask:** <URL>
**Parent Q:** Q<N>. <parent name>
**Subtask GID:** <GID>
**Type:** Meeting Inquiry

## Why we're asking
<rationale — what gap in code/docs this question fills>

## What to look for
<specific signals, named meetings/people/threads if known>

## Expected evidence
<what a useful answer looks like, with evidence flags like **operator confirmed** / **needs follow-up**>

## Likely contexts
<which meetings, retros, planning sessions, or threads probably contain this>

## Cross-reference
<links to sibling Q-topics, prior decisions, or related docs>
```

**Asana naming convention:** `Q<N>.<M> Meeting Inquiry: <description>` where `<M>` is the question number within the Q. Notes mirror Goal + Context + `---` + Prompt. IN custom field holds the prompt portion only.

**Gotchas:**

- **Convention drift between parallel agents.** Even small phrasing differences in agent prompts (e.g. "Meeting Question" vs "Meeting Inquiry") will fork the naming. Reference the canonical spec FILE by path in every agent's prompt; verify against existing sibling-folder convention BEFORE writing
- **Pre-existing artifacts.** Some folders may have partial content from prior sessions. Each agent should: list existing files first, identify covered angles, design only the NET-NEW to fill gaps, continue the existing number sequence
- **Stale `create_tasks` responses.** Sometimes the response data is from a prior unrelated call. Verify by re-fetching one created GID before patching markdown files with potentially-fake GIDs

---

## 14. Find tasks missing a value (gap audit)

Identify tasks where a field that should be populated is empty.

**Tools:** `get_tasks`, `get_task` (read-only)

**Pattern:** one agent walks the project, categorizes tasks, reports gaps

**Steps:**

1. List all top-level tasks via `get_tasks`
2. For each Q-parent (or other category), fetch parent + subtasks with the target field
3. Categorize each task:
   - **Aligned**: field is populated
   - **Gap**: field is empty AND task should have it
   - **Intentionally empty**: field is empty AND task is a container/pointer/non-question
4. Write `audit-reports/<FIELD>-GAPS.md` with the gap list and intentionally-empty list

**Output format:**

```markdown
# Tasks without <field>

## Summary
- Total audited: <N>
- Populated: <N>
- **Gaps:** <N>
- Intentionally empty: <N>

## Gaps
### Under Q<X>
- <GID> · <name>
- ...

## Intentionally empty (no action)
- Container parents: ...
- Non-question top-level: ...
```

---

## 15. Disposition duplicate task families

When two parallel sets of similar subtasks exist (e.g. one set authored in session A, another in session B with overlapping topics), audit + decide per pair.

**Tools:** `get_task` (read-only audit), `update_tasks` (rename+populate), `delete_task` (decommission)

**Steps:**

1. **Audit pairs** — for each empty subtask, find its populated counterpart by topic. Pair them up
2. **Verdict per pair:**
   - **Same topic** → decommission empty
   - **Different angle** → populate empty + renumber to extend the existing sequence (e.g. .1-.6 stays, empties become .7-.9)
3. **Apply:**
   - Delete the decommission targets via `delete_task` (loop)
   - For the keepers: batched `update_tasks` with `{task, name, custom_fields: {<IN-GID>: <prompt>}}`
4. **Also update markdown files** on disk: delete orphans, rename renumbered files, patch headers

**Gotcha:** the deleted subtasks' GIDs may appear in other markdown files as references. Search for stale GID references before declaring complete.

---

## 16. Retag custom-field enums (e.g. Artifact type)

Re-tag tasks' enum custom field to a more accurate option based on task type/content.

**Tools:** `get_project` (discover options), `get_tasks` + `get_task` (read current values), `update_tasks` (apply)

**Steps:**

1. Discover the field's enum options via `get_project`. Capture each option's `name` + `gid`
2. Define a mapping table (task pattern → appropriate enum option)
3. For each task, fetch its current enum value; compare against the mapping. Skip if already correct (idempotency)
4. Batch updates: `{"task": "<GID>", "custom_fields": {"<field-GID>": "<option-GID>"}}` (option-GID, not display name)

**Useful mapping shapes:**

| Task pattern | Likely enum option |
|---|---|
| Codebase tracing / analysis subtasks | `Codebase Analysis` or `Analysis` |
| The half-page write-up deliverable | `Report` |
| Per-image visual subtasks | `Infographic - Normal` (default) |
| Multi-image wrapper subtasks | `Infographic - Detailed` |
| Mind-map subtasks | `Mind map` |
| 1-2 min narrated walkthroughs | `Video - Brief` |
| 3-4 min narrated walkthroughs | `Video - Explainer` |
| Tabular deliverables | `Data Table` |
| Meeting-recording inquiry subtasks | `Meeting Inquiry` |
| Project scaffolding | `Preparation` |
| Codebase cleanup | `Remediation` |

**Gotcha:** flag ambiguous cases (e.g. infographic density: Concise vs Normal vs Detailed) for user review rather than guessing

---

## 17. Set task dependencies (Research → Visuals → Video → Deliverable graph)

Wire `dependencies` between subtasks so downstream artifacts wait on upstream evidence. Canonical reusable use case: a documentation-style parent where subtasks are classifiable by name prefix into types, and the types form a DAG layered from research to deliverable.

**Tools:** `get_task` (discover current deps), `update_tasks` (apply `add_dependencies`)

**Pattern:** N parallel agents — one per parent. Each agent classifies its subtasks, computes deps from the DAG, then sends ONE batched `update_tasks` call. Idempotent via current-deps inspection

**Classification by name prefix:**

| Prefix pattern | Type |
|---|---|
| `Research:` | Research |
| `Codebase Analysis:` | Research |
| `Analysis:` | Research |
| `Documentation:` | Documentation |
| `Infographic` | Infographic |
| `Mind Map` | Mind Map |
| `Video Script:` | Video Script |
| `Deliverable:` | Deliverable |
| `Meeting Inquiry:` | Meeting Inquiry (no deps, parallel with Research) |

**Dependency graph:**

```
                              ┌──────────────────────┐
                              │  Meeting Inquiry     │   (no deps; parallel)
                              └──────────────────────┘

  ┌──────────────────────┐        ┌──────────────────────┐
  │  Research / Analysis │───────►│  Documentation       │
  │  (no deps)           │    │   │  Infographic         │───┐
  └──────────────────────┘    │   │  Mind Map            │   │
                              └──►└──────────────────────┘   │
                                                             ▼
                                                ┌──────────────────────┐
                                                │  Video Script        │
                                                └──────────────────────┘
                                                             │
                                                             ▼
                                                ┌──────────────────────┐
                                                │  Deliverable         │
                                                │  (depends on all     │
                                                │   except Research)   │
                                                └──────────────────────┘
```

Layer rules:

- **Research / Analysis** and **Meeting Inquiry** — no deps
- **Documentation / Infographic / Mind Map** — depend on ALL Research+Analysis subtasks under the same parent
- **Video Script** — depends on ALL Documentation+Infographic+Mind Map subtasks
- **Deliverable** — depends on everything except Research (i.e. Documentation + Infographic + Mind Map + Video Script + Meeting Inquiry)

**Fan-out is permissive:** if a parent has N research subtasks, every visual/doc gets all N as deps. Don't try to narrow which research feeds which visual — the typed graph is the contract.

**Discovery call:**

```text
get_task(task_id="<parent-GID>", include_subtasks=true, include_comments=false,
  opt_fields="name,subtasks.gid,subtasks.name,subtasks.dependencies.gid")
```

This returns each subtask's current `dependencies` set in one round-trip. Use it to drive both classification (from `name`) and idempotency (from `dependencies.gid`).

**API call shape (batched):**

```json
{
  "tasks": [
    {"task": "<subtask-GID>", "add_dependencies": ["<dep-GID-1>", "<dep-GID-2>"]},
    {"task": "<subtask-GID>", "add_dependencies": ["<dep-GID-3>"]}
  ]
}
```

Notes:

- Batch limit is 50 task updates per call — split if a parent has more downstream subtasks than that
- `add_dependencies` is **additive**: passing a GID that's already in the subtask's deps is a no-op (server-side)
- Use real GIDs like `1209876543210987`, never display names

**Idempotency rule:**

Before computing `add_dependencies` for a subtask, read its current `dependencies` set (from the discovery call). If the current set already covers every target dep, skip that subtask entirely. Re-runs become safe no-ops.

```text
target_deps = compute_deps_for(subtask)
current_deps = set(subtask.dependencies.gid)
missing = target_deps - current_deps
if missing is empty: skip
else: add_dependencies = list(missing)
```

**Cycle handling:**

Asana returns HTTP 400 on cycle attempts. The classification-based graph is acyclic by construction (Research → Visuals → Video → Deliverable is strictly layered), but if the API rejects a specific edge, log the rejection + skip that single edge. Don't abort the whole batch.

**Cross-parent dependencies (optional follow-up):**

A container parent (e.g. `X. <big topic>`) can depend on its sub-question children (`X-A`, `X-B`, `X-C`) via the same `add_dependencies` mechanism — Asana allows cross-parent edges, including subtask-of-A depending on subtask-of-B. Useful when one sub-question's deliverable feeds another sub-question's research. Same idempotency + cycle rules apply.

**Fan-out via parallel agents:**

When there are many parent tasks (e.g. 20 leaf parents), spawn ONE agent per parent in parallel. Each agent:

1. Reads the shared `SPEC.md` (don't restate the rules in each prompt)
2. Fetches its parent's subtask GIDs + names + current deps in one `get_task` call
3. Classifies subtasks by name prefix
4. Computes target deps per subtask from the DAG
5. Applies idempotency check
6. Sends ONE batched `update_tasks` call (split if > 50 updates)
7. Writes a per-parent report to disk: `dep-reports/<parent-slug>.md` with classification table + applied edges + skipped (already-covered) subtasks

**SPEC.md template (headings to reuse):**

```markdown
# Dependency Wiring Spec

## Classification table
<prefix → type table>

## Dependency edges
<DAG description: which type depends on which>

## Batched update call shape
<update_tasks JSON skeleton with add_dependencies>

## Idempotency rule
<current-deps fetch + set diff before apply>

## Cycle handling
<400 → log + skip single edge, don't abort batch>
```

**Gotchas:**

- `opt_fields` must include `subtasks.dependencies.gid` explicitly — the default projection omits it, and you'll re-apply deps every run
- A subtask classified as type T but with no upstream peers (e.g. a lone Video Script with no Documentation/Infographic/Mind Map siblings) gets zero deps — that's correct, not a bug
- Subtasks whose name prefix doesn't match the classification table should be flagged in the per-parent report, not silently skipped — they may indicate a naming-convention drift (operation 5)

**Verify:**

- Re-fetch one wired subtask with `opt_fields="dependencies.gid,dependencies.name"`; confirm the deps list matches the target
- Re-run the same agent against the same parent: every subtask should be reported as "already covered, skipped"

**Revert:** `update_tasks` with `remove_dependencies: [<GID>, ...]` per subtask. Keep the agent's per-parent report as the revert manifest.

---

## 18. Create / inspect / move sections (REST, since MCP lacks section tools)

The primary Asana MCP server does NOT expose `create_section`, `update_section`, `delete_section`, or `list_sections`. The only path is direct REST. Project section management therefore lives outside the MCP layer entirely — either as ad-hoc `curl` calls or via the TypeScript wrappers under `../scripts/`.

**Tools (REST only — no MCP equivalents):**

| Operation | Method + path | Body (under top-level `data`) |
|---|---|---|
| Create section | `POST /projects/{project_gid}/sections` | `{name, insert_after?, insert_before?}` |
| List sections | `GET /projects/{project_gid}/sections` | _(none)_ |
| Update section name | `PUT /sections/{section_gid}` | `{name}` |
| Delete section | `DELETE /sections/{section_gid}` | _(none)_ |
| Move task to section within project | `POST /tasks/{task_gid}/addProject` | `{project, section}` |

**Auth:** `Authorization: Bearer <PAT>`, where `<PAT>` is loaded from the `ASANA_PAT` env var. The PAT is created at `https://app.asana.com/0/my-apps` → "Personal access tokens".

**Pattern:** one ad-hoc call or one batched script run. No parallel fan-out needed — section operations are O(sections), not O(tasks).

**Steps (most common — create a new section, then move tasks into it):**

1. Call `POST /projects/{project_gid}/sections` with `{name: "<new section name>"}`. Capture the returned `gid`.
2. For each task that should land in the new section, call `POST /tasks/{task_gid}/addProject` with `{project: "<project-GID>", section: "<new-section-GID>"}`. No batch endpoint exists — loop sequentially.
3. (Optional) Verify by re-calling `GET /projects/{project_gid}/sections` and confirming the section is present.

**Insertion order:**

- Default: a created section is appended at the end of the project's section list.
- `insert_before: "<section-GID>"` places the new section immediately before the named one.
- `insert_after: "<section-GID>"` places it immediately after.
- Pass at most one of `insert_after` / `insert_before` per call.

**Move (re-place) an existing task into a section:**

```bash
curl -sS -X POST "https://app.asana.com/api/1.0/tasks/<task-GID>/addProject" \
  -H "Authorization: Bearer $ASANA_PAT" \
  -H "Content-Type: application/json" \
  -d '{"data":{"project":"<project-GID>","section":"<section-GID>"}}'
```

Asana treats this as idempotent — re-placing into the same section is a no-op. Re-placing into a different section in the same project replaces the prior section assignment (tasks have 1 section per project).

**Wrappers (this skill):**

Use the scripts under `../scripts/` for nicer ergonomics — env-var-driven, JSON output, retry handling, and per-task reporting:

- `../scripts/create-section.ts`
- `../scripts/list-sections.ts`
- `../scripts/move-tasks-to-section.ts`

Each one loads `ASANA_PAT` and `ASANA_DEFAULT_PROJECT_GID` from `../.env` via Node's `--env-file` flag. See `../scripts/README.md` for invocation examples.

**Gotchas:**

- **MCP `update_tasks` with `add_projects: [{project_id, section_id}]` DOES move tasks between sections** — see operation 10. It's the right tool when you're already in an MCP-driven workflow and only need section moves. The REST endpoint above is the right tool when you need to *create* the destination section first, or when you're scripting outside the MCP layer entirely.
- **Section GIDs are project-scoped.** A section GID is meaningful only inside its parent project. Don't pass it as a task GID or a project GID.
- **Deleting a section does not delete its tasks.** Tasks in the deleted section get re-assigned to "(no section)" within the same project. Confirm task placement after a delete.
- **Stale-response bug pattern.** REST does not exhibit the MCP server's cross-wired-payload bug, but it is still worth verifying that the returned section's `gid` is brand-new (not echoed from a prior call) and that subsequent `addProject` calls reference that exact GID.

**Verify:** re-call `GET /projects/{project_gid}/sections`; confirm the new section is present in the expected position. For task moves, re-fetch a moved task with `opt_fields=memberships.section.gid,memberships.section.name` and confirm.

**Revert:**

- Created a section by mistake → `DELETE /sections/{section_gid}`.
- Moved tasks into the wrong section → `POST /tasks/{task_gid}/addProject` with the original `{project, section}` pair.

---

## 19. Manage task attachments (upload / list / delete via REST)

The primary Asana MCP server exposes **only** `get_attachments` (read). For uploads and deletes there is no MCP coverage — direct REST is the only path. Use this operation when you need to attach a generated report / artifact to a task as durable evidence, or to clean up a duplicate upload caused by the curl-pipe gotcha below.

**Tools:**

| Operation | Method + path | MCP coverage |
|---|---|---|
| List attachments on a task | `GET /tasks/{task_gid}/attachments` | `get_attachments` (covered) |
| Upload an attachment | `POST /tasks/{task_gid}/attachments` (`multipart/form-data`) | **none — REST only** |
| Delete an attachment | `DELETE /attachments/{attachment_gid}` | **none — REST only** |
| Upload via the alternative parent route | `POST /attachments` with `parent` form field | **none — REST only** (less ergonomic; prefer the task-scoped path above) |

**Auth:** `Authorization: Bearer <ASANA_PAT>`.

**Pattern:** sequential per file. No batch endpoint exists for uploads or deletes — loop one HTTP call per file / GID.

**Upload — request shape:**

```bash
curl --fail --request POST \
  --url "https://app.asana.com/api/1.0/tasks/<task-GID>/attachments" \
  --header "Authorization: Bearer $ASANA_PAT" \
  --form "file=@/local/path/to/file.json;type=application/json;filename=display-name.json"
```

- `file=@<path>` — the local file (required).
- `;type=<mime>` — MIME hint. Optional; defaults to `application/octet-stream`.
- `;filename=<display-name>` — **overrides the attachment display name** in Asana. Without it, the on-disk filename is used. Useful when many files share a generic name (`openapi.json`, `report.json`) but you want distinct names in the UI.

**Response shape (immediate POST):**

```json
{
  "data": {
    "gid": "1211112222333344",
    "name": "display-name.json",
    "resource_subtype": "asana",
    "resource_type": "attachment",
    "created_at": "2026-05-13T...",
    "size": null,
    "view_url": null,
    "download_url": null,
    "permanent_url": null
  }
}
```

`size` and the `*_url` fields can be `null` immediately after upload — they populate after server-side processing. Re-list with `GET /tasks/{task_gid}/attachments` a few seconds later to confirm the final values.

**Delete — request shape:**

```bash
curl --fail -X DELETE "https://app.asana.com/api/1.0/attachments/<attachment-GID>" \
  -H "Authorization: Bearer $ASANA_PAT"
# Success: {"data":{}}
```

**Steps (typical upload flow):**

1. (Optional, recommended) `GET /tasks/{task_gid}/attachments?opt_fields=name,size`. If a name + size match is already present, skip the upload entirely.
2. `POST /tasks/{task_gid}/attachments` with `multipart/form-data`. Capture the response to a variable BEFORE parsing.
3. Parse the response and record the returned `gid` for revert purposes.
4. (Optional) Re-list and confirm the new attachment is present with the expected name and size.

**Idempotency rule:** there is no server-side dedupe — every `POST` creates a new attachment row, even if the file is byte-identical to one already attached. Before uploading, **list current attachments and skip if a name + size match exists.** The wrapper `../scripts/upload-attachment.ts` implements this with `--skip-if-exists`.

**Gotchas:**

- **curl-pipe duplication.** Pattern `curl -X POST ... | python3 -c '...'` (or any other inline parser): if the parse step throws, the curl call has ALREADY uploaded the file. Naively retrying creates a duplicate attachment. Mitigations:
  - Use `curl --fail` so curl exits non-zero on HTTP error (catches HTTP failures, NOT parser bugs).
  - Always capture the response to a variable first, then parse separately:
    `RESPONSE=$(curl ...); echo "$RESPONSE" | jq ...`
  - For attachment uploads specifically, verify via `GET /tasks/{task_gid}/attachments` BEFORE retrying — if the file is already there, skip the retry.
- **Use task-scoped endpoint, not `/attachments`.** `POST /attachments` with a `parent` form field works but is less ergonomic and easier to misuse. Prefer `POST /tasks/{task_gid}/attachments`.
- **`size` may be `null` immediately.** Don't rely on `data.size` from the POST response for downstream logic — list-and-confirm after upload.
- **`get_attachments` is the only MCP tool in this domain.** Any write surface — upload, delete, rename — requires REST.
- **No rename endpoint.** Asana has no API to rename an existing attachment. To "rename": upload the file again with the desired display name, confirm, then delete the old GID.
- **Project / project_brief attachments** use different parent types. This operation entry is task-scoped; consult the Asana API docs if you need attachments on a project or project_brief.

**Wrappers (this skill):**

- `../scripts/list-attachments.ts` — `GET /tasks/{task_gid}/attachments`, table or `--json`.
- `../scripts/upload-attachment.ts` — multipart upload with `--name`, `--type`, `--skip-if-exists` flags.
- `../scripts/delete-attachment.ts` — looped `DELETE /attachments/{gid}` with per-GID JSON report.

Each loads `ASANA_PAT` from `../.env` via Node's `--env-file` flag. See `../scripts/README.md` for invocation details.

**Verify:**

- After upload: `GET /tasks/{task_gid}/attachments` and confirm the new GID is present with the expected `name` and `size`.
- After delete: `GET /tasks/{task_gid}/attachments` and confirm the deleted GID is gone. (Deletes are immediate; no soft-delete window via the API.)

**Revert:**

- Uploaded the wrong file → `DELETE /attachments/{new-attachment-GID}` (capture the GID from the POST response).
- Deleted an attachment by mistake → re-upload the source file with the same display name. The new GID will differ — update any downstream references.

