#!/usr/bin/env -S npx tsx
/**
 * @fileoverview Upload a local file as an attachment on an Asana task via REST.
 *
 * Why: the primary Asana MCP server does NOT expose any attachment-write
 * tools. Uploads must go through `POST /tasks/{task_gid}/attachments` as
 * `multipart/form-data`. This script wraps that call with optional
 * idempotency via `--skip-if-exists` (name + size match check).
 *
 * Endpoint: `POST /tasks/{task_gid}/attachments`
 *
 * GOTCHA — curl-pipe duplication: if you call this endpoint with
 * `curl -X POST ... | jq ...` and the parsing step crashes, the curl call
 * has ALREADY uploaded the file. Naively retrying creates a duplicate.
 * This script avoids the issue by capturing the full response first, then
 * parsing — and, with `--skip-if-exists`, by listing existing attachments
 * before uploading.
 *
 * Usage:
 *   tsx --env-file=../.env upload-attachment.ts --task <task-GID> \
 *       [--name <display-name>] \
 *       [--type <mime-type>] \
 *       [--skip-if-exists] \
 *       [--quiet] \
 *       <file-path>
 *
 * Examples:
 *   # Upload with the on-disk filename as the display name:
 *   tsx --env-file=../.env upload-attachment.ts \
 *       --task 1209876543210987 \
 *       /tmp/report.json
 *
 *   # Override display name + MIME and skip if already attached:
 *   tsx --env-file=../.env upload-attachment.ts \
 *       --task 1209876543210987 \
 *       --name "Q3 audit (2026-05-13).json" \
 *       --type application/json \
 *       --skip-if-exists \
 *       /tmp/q3-audit.json
 *
 * Env vars consumed:
 *   ASANA_PAT (required)
 *
 * Exit codes:
 *   0  upload succeeded OR skipped via --skip-if-exists
 *   1  validation / API error
 *
 * @testing CLI: From skills/asana/scripts run `npx tsx --env-file=../.env upload-attachment.ts --task <task_gid> <file-path>` with `ASANA_PAT` in the environment; expect exit code 0 and stdout JSON containing `attachment_gid` on upload, or `skipped: true` when `--skip-if-exists` matches name and size.
 * @see skills/asana/scripts/_lib/client.ts - Asana REST helpers for listing and uploading attachments that this CLI composes with local file checks and optional skip-if-exists deduplication.
 * @see skills/asana/scripts/_lib/cli.ts - Shared argv parsing (`parseArgs`, `requireFlag`, `booleanFlag`) aligned with other asana scripts in this folder.
 * @documentation reviewed=2026-05-13 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */

import { basename } from "node:path";
import { stat } from "node:fs/promises";

import {
  parseArgs,
  requireFlag,
  optionalFlag,
  booleanFlag,
} from "./_lib/cli";
import {
  listAttachments,
  uploadAttachment,
  type AsanaAttachment,
} from "./_lib/client";
import { info, success, error, setQuiet } from "./_lib/log";

/**
 * Parses CLI flags, validates the local file, optionally skips when a same-name same-size attachment exists, then uploads.
 *
 * @remarks
 * I/O: `stat` on the local path; optional `listAttachments` then `uploadAttachment` against Asana. Writes progress to stderr via `_lib/log` and a JSON summary line to stdout. Calls `process.exit(1)` on validation or transport failures instead of throwing past the top-level catch.
 */
async function main(): Promise<void> {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (booleanFlag(flags, "quiet")) setQuiet(true);

  const filePath = positional[0];
  if (!filePath) {
    error(
      "Missing file path. Usage: upload-attachment --task <task-GID> [--name <display>] [--type <mime>] [--skip-if-exists] <file-path>",
    );
    process.exit(1);
  }

  const taskGid = requireFlag(flags, "task");
  const displayName = optionalFlag(flags, "name") ?? basename(filePath);
  const contentType = optionalFlag(flags, "type");
  const skipIfExists = booleanFlag(flags, "skip-if-exists");

  // Validate that the local file exists and capture its size for idempotency.
  let localSize: number;
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      error(`Path is not a regular file: ${filePath}`);
      process.exit(1);
    }
    localSize = stats.size;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error(`Cannot read file ${filePath}: ${msg}`);
    process.exit(1);
  }

  if (skipIfExists) {
    info(
      `Checking for existing attachment "${displayName}" (size=${localSize}) on task ${taskGid}…`,
    );
    const existing = await listAttachments(taskGid);
    const match = existing.find(
      (a: AsanaAttachment) =>
        a.name === displayName && a.size === localSize,
    );
    if (match) {
      success(
        `skip: attachment ${match.gid} ("${match.name}", size=${match.size}) already on task`,
      );
      process.stdout.write(
        JSON.stringify(
          {
            skipped: true,
            attachment_gid: match.gid,
            name: match.name,
            size: match.size,
            view_url: match.view_url ?? null,
          },
          null,
          2,
        ) + "\n",
      );
      return;
    }
    info(`No name+size match found. Proceeding with upload.`);
  }

  info(
    `Uploading "${filePath}" as "${displayName}" (size=${localSize}) to task ${taskGid}…`,
  );
  const attachment = await uploadAttachment({
    taskGid,
    filePath,
    displayName,
    ...(contentType !== undefined ? { contentType } : {}),
  });

  success(`uploaded attachment ${attachment.gid} ("${attachment.name}")`);
  process.stdout.write(
    JSON.stringify(
      {
        skipped: false,
        attachment_gid: attachment.gid,
        name: attachment.name,
        size: attachment.size ?? null,
        view_url: attachment.view_url ?? null,
      },
      null,
      2,
    ) + "\n",
  );
}

main().catch((err: unknown) => {
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
