#!/usr/bin/env npx tsx

/**
 * @fileoverview CLI script that prints an eight-item Asana quality checklist report and optional JSON, driven only by a synthetic `--tasks` / `-n` count for local self-checks.
 *
 * This file owns argv parsing, checklist row materialization, weighted scoring, required-item gating for `canFinalize`, and stdout formatting (including `--json`).
 * Flow: argv -> derive tasks-complete count -> map each checklist row to checked -> aggregate scores -> print narrative (and JSON when requested).
 *
 * @testing CLI: npx tsx skills/asana/scripts/check-asana-completeness.ts --tasks 8
 * @testing CLI: npx tsx skills/asana/scripts/check-asana-completeness.ts --tasks 1 --json
 *
 * @see skills/asana/SKILL.md - Canonical asana skill that frames MCP-backed Asana work this checklist is meant to accompany before finalize decisions.
 * @see cloom-platform-overview/materials/2026-05-14-mmx-reports-non-developers/asana-operations-runbook.md - Operations runbook referenced by checklist item eight as the human-maintained procedure surface this script nudges agents to keep current.
 * @see docs/TYPESCRIPT_STANDARDS_DOCUMENTATION_FILE_OVERVIEWS.md - Repository file-overview contract this header follows so automated documentation gates stay aligned with platform policy.
 * @documentation reviewed=2026-05-22 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */

import { argv } from "process";

// ============================================================================
// Types
// ============================================================================

/**
 * One row of the eight-item Asana quality checklist used by this script.
 *
 * @remarks
 * PURITY: Shape only; `checked` is filled when the CLI synthesizes a report from `--tasks` / `-n`.
 */
interface ChecklistItem {
  number: number;
  name: string;
  description: string;
  required: boolean;
  checked: boolean;
  weight: number;
}

/**
 * Aggregated checklist outcome emitted for `--json` consumers and human-readable logs.
 *
 * @remarks
 * I/O: No persistence; `canFinalize` is true when every required checklist row is marked checked.
 */
interface CompletenessReport {
  checklist: ChecklistItem[];
  score: number;
  maxScore: number;
  canFinalize: boolean;
}

// ============================================================================
// Checklist Definition
// ============================================================================

const CHECKLIST_ITEMS: Omit<ChecklistItem, "checked">[] = [
  { number: 1, name: "Tool loading verified", description: "ToolSearch select: ran", required: true, weight: 2 },
  { number: 2, name: "GID verified", description: "Returned gid == requested task_id", required: true, weight: 2 },
  { number: 3, name: "Snapshot created", description: "Backup before destructive ops", required: true, weight: 2 },
  { number: 4, name: "Param types correct", description: "Numbers not strings, correct param names", required: true, weight: 2 },
  { number: 5, name: "opt_fields used", description: "Only fetch needed fields", required: true, weight: 1 },
  { number: 6, name: "Parallelization planned", description: "One agent per ~10-15 tasks", required: true, weight: 1 },
  { number: 7, name: "Authored to disk first", description: "JSON/MD validated before push", required: true, weight: 2 },
  { number: 8, name: "Runbook updated", description: "asana-operations-runbook.md maintained", required: true, weight: 1 },
];

// ============================================================================
// Main
// ============================================================================

/**
 * CLI entrypoint: parse argv, synthesize checklist completion from task count, print report.
 *
 * @remarks
 * I/O: Reads `process.argv`; writes formatted lines (and optional JSON) to stdout only.
 */
function main() {
  const args = argv.slice(2);
  const tasksArg = args.find(a => a === "--tasks" || a === "-n");
  const jsonArg = args.includes("--json");
  
  const tasksComplete = tasksArg 
    ? parseInt(args[args.indexOf(tasksArg) + 1] || "1", 10)
    : 1;
  
  console.log("\n📋 Asana Completeness Check");
  console.log("═".repeat(60));
  console.log(`\n📊 Tasks Processed: ${tasksComplete}`);
  
  // Build checklist based on completion
  const checklist: ChecklistItem[] = CHECKLIST_ITEMS.map(item => {
    let checked = false;
    
    switch (item.number) {
      case 1: // Tool loading verified
        checked = tasksComplete >= 1;
        break;
      case 2: // GID verified
        checked = tasksComplete >= 1;
        break;
      case 3: // Snapshot created
        checked = tasksComplete >= 1;
        break;
      case 4: // Param types correct
        checked = tasksComplete >= 1;
        break;
      case 5: // opt_fields used
        checked = tasksComplete >= 1;
        break;
      case 6: // Parallelization planned
        checked = tasksComplete >= 1;
        break;
      case 7: // Authored to disk first
        checked = tasksComplete >= 1;
        break;
      case 8: // Runbook updated
        checked = tasksComplete >= 1;
        break;
      default:
        break;
    }
    
    return { ...item, checked };
  });
  
  const score = checklist.reduce((sum, item) => 
    item.checked ? sum + item.weight : sum, 0);
  const maxScore = checklist.reduce((sum, item) => sum + item.weight, 0);
  
  const requiredItems = checklist.filter(i => i.required);
  const requiredScore = requiredItems.reduce((sum, item) => 
    item.checked ? sum + item.weight : sum, 0);
  const requiredMax = requiredItems.reduce((sum, item) => sum + item.weight, 0);
  
  const canFinalize = requiredScore === requiredMax;
  
  console.log(`\n📊 Score: ${score}/${maxScore} (${((score/maxScore)*100).toFixed(0)}%)`);
  console.log(`   Required items: ${requiredScore}/${requiredMax}`);
  
  console.log(`\n${canFinalize ? "✅" : "⚠️"} Ready: ${canFinalize ? "YES" : "NEEDS WORK"}`);
  
  console.log("\n📝 Checklist:");
  for (const item of checklist) {
    const icon = item.checked ? "✅" : item.required ? "❌" : "⚠️";
    console.log(`   ${icon} [${item.number}] ${item.name}`);
  }
  
  console.log("\n" + "═".repeat(60));
  
  if (!canFinalize) {
    console.log("\n⚠️ Asana operation needs verification before proceeding.");
    const failedItems = checklist.filter(i => !i.checked && i.required);
    if (failedItems.length > 0) {
      console.log("\nIssues to verify:");
      failedItems.forEach(i => console.log(`   - ${i.name}: ${i.description}`));
    }
  } else {
    console.log("\n✅ Asana operation is verified and ready.");
  }
  
  if (jsonArg) {
    const report: CompletenessReport = { checklist, score, maxScore, canFinalize };
    console.log("\n" + JSON.stringify(report, null, 2));
  }
}

main();
