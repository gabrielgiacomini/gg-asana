#!/usr/bin/env -S npx tsx
/**
 * @fileoverview Delete one or more Asana attachments by GID via REST.
 *
 * Why: the primary Asana MCP server does NOT expose any attachment-delete
 * tool. Deletes must go through `DELETE /attachments/{attachment_gid}`,
 * which returns `{"data":{}}` on success.
 *
 * Endpoint: `DELETE /attachments/{attachment_gid}`
 *
 * Asana has no batch endpoint — the script loops one DELETE per GID and
 * reports per-attachment success / failure. Useful when undoing a duplicate
 * upload caused by the curl-pipe gotcha (see `upload-attachment.ts`).
 *
 * Usage:
 *   tsx --env-file=../.env delete-attachment.ts [--quiet] \
 *       <attachment-GID-1> [<attachment-GID-2> ...]
 *
 * Example:
 *   tsx --env-file=../.env delete-attachment.ts 1211112222333344 1211112222333345
 *
 * Env vars consumed:
 *   ASANA_PAT (required)
 *
 * Exit codes:
 *   0  every attachment deleted successfully
 *   1  at least one delete failed; per-GID JSON report on stdout
 *
 * @testing CLI: In skills/asana/scripts, run `npx tsx --env-file=../.env delete-attachment.ts <attachment-GID>` with ASANA_PAT available via env or ../.env; confirm stdout prints JSON with a `results` array per GID and exit 0 only when every row reports `deleted`.
 * @see skills/asana/scripts/_lib/client.ts - Supplies `deleteAttachment` plus `AsanaApiError` shaping for HTTP failures surfaced in the per-GID loop.
 * @see skills/asana/scripts/upload-attachment.ts - Companion upload CLI that explains the duplicate-upload curl gotcha operators often undo with this delete script.
 * @documentation reviewed=2026-05-13 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */

import { parseArgs, booleanFlag } from "./_lib/cli";
import { AsanaApiError, deleteAttachment } from "./_lib/client";
import { info, success, warn, error, setQuiet } from "./_lib/log";

/**
 * One stdout JSON row describing how a single attachment GID delete attempt ended.
 *
 * @remarks
 * Values are accumulated into the `{ results }` object written to stdout for automation and human
 * review alongside `_lib/log` lines.
 */
interface Result {
  attachmentGid: string;
  status: "deleted" | "failed";
  message?: string;
}

/**
 * Parses argv, runs sequential DELETEs, prints JSON results, and sets the process exit code.
 *
 * @remarks
 * I/O: Asana REST deletes via `deleteAttachment` per GID; logs through `_lib/log`; always prints a
 * JSON summary to stdout before exiting.
 */
async function main(): Promise<void> {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (booleanFlag(flags, "quiet")) setQuiet(true);

  const gids = positional;
  if (gids.length === 0) {
    error(
      "No attachment GIDs provided. Usage: delete-attachment <attachment-GID-1> [<attachment-GID-2> ...]",
    );
    process.exit(1);
  }

  info(`Deleting ${gids.length} attachment(s)…`);

  const results: Result[] = [];
  for (const gid of gids) {
    try {
      await deleteAttachment(gid);
      results.push({ attachmentGid: gid, status: "deleted" });
      success(`deleted ${gid}`);
    } catch (err) {
      const message =
        err instanceof AsanaApiError
          ? `${err.status} ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      results.push({ attachmentGid: gid, status: "failed", message });
      warn(`failed ${gid}: ${message}`);
    }
  }

  const failed = results.filter((r) => r.status === "failed");
  process.stdout.write(JSON.stringify({ results }, null, 2) + "\n");

  if (failed.length > 0) {
    error(`${failed.length} of ${results.length} deletes failed`);
    process.exit(1);
  }
  success(`All ${results.length} attachment(s) deleted`);
}

main().catch((err: unknown) => {
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
