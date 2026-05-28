#!/usr/bin/env -S npx tsx
/**
 * @fileoverview Wire subtask dependencies for one parent task using the
 * Research → Visuals/Doc → Video Script → Deliverable DAG.
 *
 * This is the script-form of the operation documented in
 * `references/operations-catalog.md` (entry #17). Read that entry first for
 * the dependency-graph rationale, classification table, and idempotency
 * contract.
 *
 * Summary of layers:
 *   - Research / Analysis subtasks      → no deps
 *   - Meeting Inquiry subtasks          → no deps (parallel with Research)
 *   - Documentation / Infographic /
 *     Mind Map subtasks                 → depend on ALL Research+Analysis peers
 *   - Video Script                      → depends on ALL Doc + Infographic + Mind Map
 *   - Deliverable                       → depends on everything except Research
 *
 * REST endpoints used:
 *   GET  /tasks/{parent_gid}                    (verify parent)
 *   GET  /tasks/{parent_gid}/subtasks?opt_fields=name,dependencies.gid
 *   POST /tasks/{task_gid}/addDependencies      { data: { dependencies: [...] } }
 *
 * Note: `addDependencies` is additive on the server side, so passing an
 * already-present GID is a no-op. The script still computes the diff
 * (target - current) locally so the per-subtask report is accurate.
 *
 * Usage:
 *   tsx --env-file=../.env set-task-dependencies.ts --parent <parent-GID> [--dry-run] [--quiet]
 *
 * Example:
 *   tsx --env-file=../.env set-task-dependencies.ts \
 *       --parent 1209876543210987 --dry-run
 *
 * Env vars consumed:
 *   ASANA_PAT  (required)
 *
 * Exit codes:
 *   0  success (or dry-run completed)
 *   1  validation error / unhandled exception / or one-or-more subtasks recorded a dependency failure
 *
 * @testing ESLint: `npx eslint skills/asana/scripts/set-task-dependencies.ts` from repo root (also `npm run lint:root-repo-only`).
 * @testing CLI: `tsx --env-file=../.env set-task-dependencies.ts --parent <parent_gid> --dry-run` with `ASANA_PAT` available (smoke the planner without mutating deps).
 * @see skills/asana/references/operations-catalog.md - Catalog entry #17 (DAG rationale, classification table, idempotency contract for this script).
 * @see skills/asana/scripts/_lib/client.ts - Shared Asana REST helpers (`getTaskWithSubtaskDeps`, `addDependencies`, `AsanaApiError`) used after argv parsing.
 * @see docs/TYPESCRIPT_STANDARDS_DOCUMENTATION_JSDOC.md - Symbol-level JSDoc contract paired with root ESLint `eslint-plugin-jsdoc` rules on this file.
 * @documentation reviewed=2026-05-13 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */

import {
  parseArgs,
  requireFlag,
  booleanFlag,
} from "./_lib/cli";
import {
  getTaskWithSubtaskDeps,
  addDependencies,
  AsanaApiError,
} from "./_lib/client";
import { info, success, warn, error, setQuiet } from "./_lib/log";

/**
 * Subtask classification bucket inferred from display-name prefix heuristics.
 *
 * @remarks
 * Feeds `computeTargetDeps`; `Unclassified` rows are reported but never sent `addDependencies`.
 */
type SubtaskType =
  | "Research"
  | "Documentation"
  | "Infographic"
  | "MindMap"
  | "VideoScript"
  | "Deliverable"
  | "MeetingInquiry"
  | "Unclassified";

/**
 * One subtask after prefix classification plus current Asana dependency GIDs.
 *
 * @remarks
 * `currentDeps` mirrors dependency GIDs returned with each subtask from `getTaskWithSubtaskDeps`.
 */
interface ClassifiedSubtask {
  gid: string;
  name: string;
  type: SubtaskType;
  currentDeps: Set<string>;
}

/**
 * Ordered prefix patterns mapping Asana subtask titles to `SubtaskType` buckets.
 *
 * @remarks
 * `classify` walks this table in array order; first `pattern` match wins. Multiple patterns map into
 * `Research` so legacy “Codebase Analysis” / “Analysis” prefixes stay aligned with Research peers.
 */
const PREFIX_TABLE: Array<{ pattern: RegExp; type: SubtaskType }> = [
  { pattern: /^Research\s*:/i, type: "Research" },
  { pattern: /^Codebase Analysis\s*:/i, type: "Research" },
  { pattern: /^Analysis\s*:/i, type: "Research" },
  { pattern: /^Documentation\s*:/i, type: "Documentation" },
  { pattern: /^Infographic\b/i, type: "Infographic" },
  { pattern: /^Mind Map\b/i, type: "MindMap" },
  { pattern: /^Video Script\s*:/i, type: "VideoScript" },
  { pattern: /^Deliverable\s*:/i, type: "Deliverable" },
  { pattern: /^Meeting Inquiry\s*:/i, type: "MeetingInquiry" },
];

/**
 * Map a subtask display name to a `SubtaskType` using ordered prefix rules.
 *
 * @remarks
 * First matching `PREFIX_TABLE` entry wins; otherwise returns `Unclassified`.
 */
function classify(name: string): SubtaskType {
  for (const { pattern, type } of PREFIX_TABLE) {
    if (pattern.test(name)) return type;
  }
  return "Unclassified";
}

/**
 * Compute target dependency GIDs for one classified subtask relative to its peers.
 *
 * @remarks
 * Pure planner (no I/O). Omits self-edges. Encodes the Research → Docs/Infographic/Mind Map →
 * Video Script → Deliverable DAG from the file overview; Deliverable intentionally excludes
 * Research edges while still depending on docs/visuals, video scripts, and meeting inquiry peers.
 */
function computeTargetDeps(
  current: ClassifiedSubtask,
  all: ClassifiedSubtask[],
): string[] {
  const research = all.filter((s) => s.type === "Research").map((s) => s.gid);
  const docInfographicMindMap = all
    .filter(
      (s) =>
        s.type === "Documentation" ||
        s.type === "Infographic" ||
        s.type === "MindMap",
    )
    .map((s) => s.gid);
  const videoScripts = all
    .filter((s) => s.type === "VideoScript")
    .map((s) => s.gid);
  const meetingInquiry = all
    .filter((s) => s.type === "MeetingInquiry")
    .map((s) => s.gid);

  switch (current.type) {
    case "Research":
    case "MeetingInquiry":
    case "Unclassified":
      return [];
    case "Documentation":
    case "Infographic":
    case "MindMap":
      return research.filter((g) => g !== current.gid);
    case "VideoScript":
      return docInfographicMindMap.filter((g) => g !== current.gid);
    case "Deliverable":
      return [
        ...docInfographicMindMap,
        ...videoScripts,
        ...meetingInquiry,
      ].filter((g) => g !== current.gid);
  }
}

/**
 * CLI orchestration: parse flags, load parent + subtasks, diff deps, optionally POST edges, print table.
 *
 * @remarks
 * Uses shared client env (`ASANA_PAT`). `--dry-run` skips `addDependencies`. On HTTP 400 from
 * Asana (cycles), logs a warning and continues the batch; any recorded failure rows still yield
 * exit code `1` after the summary pass.
 */
async function main(): Promise<void> {
  const { flags } = parseArgs(process.argv.slice(2));
  if (booleanFlag(flags, "quiet")) setQuiet(true);

  const parentGid = requireFlag(flags, "parent");
  const dryRun = booleanFlag(flags, "dry-run");

  info(`Fetching parent ${parentGid} + subtasks (with current dependencies)…`);
  const { parent, subtasks } = await getTaskWithSubtaskDeps(parentGid);
  info(`Parent: "${parent.name}" — ${subtasks.length} subtask(s).`);

  const classified: ClassifiedSubtask[] = subtasks.map((s) => ({
    gid: s.gid,
    name: s.name,
    type: classify(s.name),
    currentDeps: new Set((s.dependencies ?? []).map((d) => d.gid)),
  }));

  // Per-parent report rows.
  /**
   * One stdout row for the per-subtask dependency reconciliation report.
   *
   * @remarks
   * `action` reflects which branch ran; `error` captures a single-line failure summary without
   * aborting other subtasks in the batch.
   */
  interface Row {
    gid: string;
    name: string;
    type: SubtaskType;
    targetDepCount: number;
    missingDepCount: number;
    action: "apply" | "skip" | "ignore" | "dry-run";
    error?: string;
  }
  const rows: Row[] = [];

  let applied = 0;
  let skipped = 0;
  let ignored = 0;
  let failures = 0;

  for (const subtask of classified) {
    const targetDeps = computeTargetDeps(subtask, classified);
    if (subtask.type === "Unclassified") {
      ignored += 1;
      rows.push({
        gid: subtask.gid,
        name: subtask.name,
        type: subtask.type,
        targetDepCount: 0,
        missingDepCount: 0,
        action: "ignore",
      });
      continue;
    }

    const missing = targetDeps.filter((g) => !subtask.currentDeps.has(g));

    if (missing.length === 0) {
      skipped += 1;
      rows.push({
        gid: subtask.gid,
        name: subtask.name,
        type: subtask.type,
        targetDepCount: targetDeps.length,
        missingDepCount: 0,
        action: "skip",
      });
      continue;
    }

    if (dryRun) {
      rows.push({
        gid: subtask.gid,
        name: subtask.name,
        type: subtask.type,
        targetDepCount: targetDeps.length,
        missingDepCount: missing.length,
        action: "dry-run",
      });
      continue;
    }

    try {
      await addDependencies({ taskGid: subtask.gid, dependencies: missing });
      applied += 1;
      rows.push({
        gid: subtask.gid,
        name: subtask.name,
        type: subtask.type,
        targetDepCount: targetDeps.length,
        missingDepCount: missing.length,
        action: "apply",
      });
    } catch (err) {
      failures += 1;
      const message =
        err instanceof AsanaApiError
          ? `${err.status} ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      // Cycle: log + continue (don't abort batch).
      if (err instanceof AsanaApiError && err.status === 400) {
        warn(`cycle/400 on ${subtask.gid} — skipping single edge set`);
      }
      rows.push({
        gid: subtask.gid,
        name: subtask.name,
        type: subtask.type,
        targetDepCount: targetDeps.length,
        missingDepCount: missing.length,
        action: "apply",
        error: message,
      });
    }
  }

  // Render report on stdout (always — useful in dry-run too).
  const widthGid = Math.max(3, ...rows.map((r) => r.gid.length));
  const widthType = Math.max(
    4,
    ...rows.map((r) => r.type.length),
  );
  process.stdout.write(
    `${"gid".padEnd(widthGid)}  ${"type".padEnd(widthType)}  target  missing  action  name\n`,
  );
  process.stdout.write(
    `${"-".repeat(widthGid)}  ${"-".repeat(widthType)}  ------  -------  ------  ----\n`,
  );
  for (const r of rows) {
    const errorTail = r.error ? `  [ERR: ${r.error}]` : "";
    process.stdout.write(
      `${r.gid.padEnd(widthGid)}  ${r.type.padEnd(widthType)}  ${String(r.targetDepCount).padStart(6)}  ${String(r.missingDepCount).padStart(7)}  ${r.action.padEnd(7)} ${r.name}${errorTail}\n`,
    );
  }

  const summary = dryRun
    ? `DRY RUN — would apply: ${rows.filter((r) => r.action === "dry-run").length}, skip: ${skipped}, ignore: ${ignored}`
    : `applied: ${applied}, skipped: ${skipped}, ignored: ${ignored}, failures: ${failures}`;
  if (failures > 0) {
    error(summary);
    process.exit(1);
  }
  success(summary);
}

main().catch((err: unknown) => {
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
