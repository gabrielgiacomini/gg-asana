#!/usr/bin/env -S npx tsx
/**
 * @fileoverview Print a hierarchical Markdown inventory of an Asana project.
 *
 * Walks: sections → top-level tasks → subtasks (recursive). Useful as a
 * lightweight discovery snapshot — not a backup. For full content backups,
 * use the snapshot operation pattern (see references/operations-catalog.md
 * → "Backup project to disk") which captures notes + custom fields per task.
 *
 * REST endpoints used:
 *   GET /projects/{project_gid}/sections
 *   GET /tasks?project={project_gid}&opt_fields=...
 *   GET /tasks/{task_gid}/subtasks?opt_fields=...
 *
 * Usage:
 *   tsx --env-file=../.env get-project-inventory.ts \
 *       [--project <project-GID>] \
 *       [--output <path>] \
 *       [--max-depth <N>] \
 *       [--quiet]
 *
 * Defaults:
 *   --max-depth 2  (top-level + one level of subtasks)
 *   stdout if --output omitted
 *
 * Env vars consumed:
 *   ASANA_PAT                  (required)
 *   ASANA_DEFAULT_PROJECT_GID  (used when --project is omitted)
 *
 * @testing ESLint: npm run lint:root-repo-only from repo root (skills TypeScript + JSDoc).
 * @testing Repo audit: npm run check:typescript-file-overview-errors from repo root for overview tags.
 * @see skills/asana/scripts/_lib/client.ts - `listSections`, `listSubtasks`, and `asanaFetch` back the inventory pagination and subtask expansion used by this CLI.
 * @see skills/asana/scripts/README.md - Operator runbook for PAT, default project GID, and how this script fits next to other asana CLIs.
 * @see skills/asana/references/operations-catalog.md - Contrasts this shallow inventory snapshot with full backup operations that capture notes and custom fields per task.
 * @see docs/TYPESCRIPT_STANDARDS_DOCUMENTATION_JSDOC.md - JSDoc contract aligned with root ESLint rules on this file.
 * @documentation reviewed=2026-05-13 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */

import { writeFile } from "node:fs/promises";
import {
  parseArgs,
  optionalFlag,
  booleanFlag,
} from "./_lib/cli";
import {
  listSections,
  listSubtasks,
  asanaFetch,
  type AsanaSection,
  type AsanaTaskInventory,
} from "./_lib/client";
import { loadAsanaEnv } from "./_lib/env";
import { info, success, error, setQuiet } from "./_lib/log";

/**
 * Mutable tree node used while expanding subtasks before Markdown emission.
 *
 * @remarks
 * `children` is filled by `expandSubtasks`; `num_subtasks` gates further Asana pagination depth.
 */
interface TaskNode {
  gid: string;
  name: string;
  completed?: boolean;
  num_subtasks?: number;
  children: TaskNode[];
}

/**
 * Task row plus projected `memberships` so inventory output can bucket tasks into sections.
 *
 * @remarks
 * Tasks without a resolvable section GID are grouped under the orphan heading in `main`.
 */
interface SectionTaskRef extends AsanaTaskInventory {
  memberships?: Array<{ section?: { gid: string; name?: string } }>;
}

/**
 * Page through every project task including section membership metadata.
 *
 * @remarks
 * I/O: repeated `GET /tasks` via `asanaFetch` until `next_page.offset` is absent.
 */
async function listTasksWithMemberships(
  projectGid: string,
): Promise<SectionTaskRef[]> {
  const all: SectionTaskRef[] = [];
  let offset: string | undefined;
  do {
    const res = await asanaFetch<SectionTaskRef[]>(`/tasks`, {
      method: "GET",
      query: {
        project: projectGid,
        limit: 100,
        opt_fields:
          "name,completed,num_subtasks,memberships.section.gid,memberships.section.name",
        ...(offset ? { offset } : {}),
      },
    });
    all.push(...res.data);
    offset = res.next_page?.offset ?? undefined;
  } while (offset);
  return all;
}

/**
 * Recursively hydrate `node.children` from Asana subtasks up to `maxDepth`.
 *
 * @remarks
 * I/O: calls `listSubtasks` when below `maxDepth` and `num_subtasks` is positive; mutates `node.children`.
 */
async function expandSubtasks(
  node: TaskNode,
  depth: number,
  maxDepth: number,
): Promise<void> {
  if (depth >= maxDepth) return;
  if (!node.num_subtasks || node.num_subtasks === 0) return;
  const subs = await listSubtasks(node.gid, "name,completed,num_subtasks");
  for (const sub of subs) {
    const child: TaskNode = {
      gid: sub.gid,
      name: sub.name,
      completed: sub.completed,
      num_subtasks: sub.num_subtasks,
      children: [],
    };
    node.children.push(child);
    await expandSubtasks(child, depth + 1, maxDepth);
  }
}

/**
 * Serialize a task subtree as Markdown bullets with completion markers and GIDs.
 *
 * @remarks
 * PURITY: builds strings only; performs no I/O.
 */
function renderNode(node: TaskNode, indent: number): string {
  const pad = "  ".repeat(indent);
  const mark = node.completed ? "[x]" : "[ ]";
  let out = `${pad}- ${mark} ${node.name} \`(${node.gid})\``;
  out += "\n";
  for (const child of node.children) {
    out += renderNode(child, indent + 1);
  }
  return out;
}

/**
 * CLI entry: parse argv/env, fetch sections and tasks, emit Markdown to stdout or `--output`.
 *
 * @remarks
 * I/O: Asana reads through `listSections`, `listTasksWithMemberships`, and `expandSubtasks`; optional `writeFile` when `--output` is set.
 */
async function main(): Promise<void> {
  const { flags } = parseArgs(process.argv.slice(2));
  if (booleanFlag(flags, "quiet")) setQuiet(true);

  const env = loadAsanaEnv();
  const projectGid = optionalFlag(flags, "project") ?? env.defaultProjectGid;
  const outputPath = optionalFlag(flags, "output");
  const maxDepth = Number.parseInt(optionalFlag(flags, "max-depth") ?? "2", 10);

  info(`Inventorying project ${projectGid} (max depth ${maxDepth})…`);

  const [sections, tasks] = await Promise.all([
    listSections(projectGid),
    listTasksWithMemberships(projectGid),
  ]);

  const bySection = new Map<string, SectionTaskRef[]>();
  const orphans: SectionTaskRef[] = [];
  for (const t of tasks) {
    const sectionGid = t.memberships?.find((m) =>
      m.section !== undefined,
    )?.section?.gid;
    if (sectionGid) {
      const list = bySection.get(sectionGid) ?? [];
      list.push(t);
      bySection.set(sectionGid, list);
    } else {
      orphans.push(t);
    }
  }

  let markdown = `# Project ${projectGid} — inventory\n\n`;
  markdown += `_Generated by asana scripts/get-project-inventory.ts_\n\n`;
  markdown += `- Sections: ${sections.length}\n`;
  markdown += `- Top-level tasks: ${tasks.length}\n`;
  markdown += `- Max depth: ${maxDepth}\n\n`;

  /**
   * Build Markdown for one section heading plus expanded task trees assigned to that section.
   *
   * @remarks
   * I/O: each task triggers `expandSubtasks`, which may call Asana subtask endpoints until depth limits apply.
   */
  const renderSection = async (
    section: AsanaSection,
    tasksInSection: SectionTaskRef[],
  ): Promise<string> => {
    let out = `## ${section.name} \`(${section.gid})\`\n\n`;
    if (tasksInSection.length === 0) {
      out += `_(empty)_\n\n`;
      return out;
    }
    for (const t of tasksInSection) {
      const node: TaskNode = {
        gid: t.gid,
        name: t.name,
        completed: t.completed,
        num_subtasks: t.num_subtasks,
        children: [],
      };
      await expandSubtasks(node, 1, maxDepth);
      out += renderNode(node, 0);
    }
    return out + "\n";
  };

  for (const section of sections) {
    markdown += await renderSection(section, bySection.get(section.gid) ?? []);
  }

  if (orphans.length > 0) {
    markdown += `## _Tasks with no section_\n\n`;
    for (const t of orphans) {
      const node: TaskNode = {
        gid: t.gid,
        name: t.name,
        completed: t.completed,
        num_subtasks: t.num_subtasks,
        children: [],
      };
      await expandSubtasks(node, 1, maxDepth);
      markdown += renderNode(node, 0);
    }
    markdown += "\n";
  }

  if (outputPath) {
    await writeFile(outputPath, markdown, "utf8");
    success(`Wrote inventory to ${outputPath}`);
  } else {
    process.stdout.write(markdown);
  }
}

main().catch((err: unknown) => {
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
