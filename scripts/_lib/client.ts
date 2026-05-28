/**
 * @fileoverview Typed Asana REST `fetch` client for sections, task moves, inventory pagination,
 * dependencies, and attachment upload/delete—surfaces the MCP server tools omit or only partially cover.
 *
 * Bearer `ASANA_PAT` from `loadAsanaEnv` is injected on every call; JSON bodies default to Asana's
 * `{data: ...}` envelope for mutating verbs; non-2xx responses become `AsanaApiError` with parsed
 * fragments. Up to three 429 retries honor `Retry-After` with exponential fallback; optional
 * `expectedGid` re-reads once when a single-resource payload returns the wrong GID (mirrors the
 * cross-wired response hazard documented alongside the MCP stack).
 *
 * @example
 * ```typescript
 * import { listSections } from "./_lib/client";
 *
 * const sections = await listSections("1200000000000001");
 * ```
 *
 * @testing ESLint: npm run lint:root-repo-only from the repo root to apply root eslint.config.ts rules (including JSDoc) to skills TypeScript such as this module.
 * @testing Repo audit: npm run check:typescript-file-overview-errors from the repo root to validate required file-overview tags on this path.
 * @see skills/asana/scripts/_lib/env.ts loads `ASANA_PAT` and script env defaults consumed before every authenticated request issued through this module.
 * @see skills/asana/scripts/README.md lists CLI entrypoints that import these helpers for section moves, attachments, and inventory workflows.
 * @see docs/TYPESCRIPT_STANDARDS_DOCUMENTATION_JSDOC.md defines the symbol-level JSDoc contract paired with the root ESLint `eslint-plugin-jsdoc` rules exercised on this file.
 * @documentation reviewed=2026-05-13 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { loadAsanaEnv } from "./env";
import { dim, warn } from "./log";

const BASE_URL = "https://app.asana.com/api/1.0";
const MAX_RETRIES = 3;

/**
 * Domain error for failed Asana REST responses with HTTP status, path, and optional decoded body.
 *
 * @remarks
 * Thrown by `asanaFetch` and attachment helpers when `response.ok` is false so callers can branch
 * on `status` or log `body` without re-parsing transport text.
 */
export class AsanaApiError extends Error {
  override readonly name = "AsanaApiError";
  /**
   * Captures the failing request path and optional JSON payload for operator diagnostics.
   */
  constructor(
    public readonly status: number,
    public readonly path: string,
    message: string,
    public readonly body?: unknown,
  ) {
    super(`Asana ${status} on ${path}: ${message}`);
  }
}

/**
 * Options for `asanaFetch` controlling verb, JSON envelope, pagination query params, and GID guard.
 */
export interface AsanaFetchOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** JSON body. The client will wrap it in `{data: ...}` only if `wrapBody` is true. */
  body?: unknown;
  /** Wrap `body` in `{data: body}` per Asana convention. Default: true for POST/PUT/PATCH. */
  wrapBody?: boolean;
  /**
   * If set, the client verifies `response.data.gid === expectedGid` on the
   * decoded payload and retries once on mismatch.
   */
  expectedGid?: string;
  /** Extra query params appended to the URL. */
  query?: Record<string, string | number | undefined>;
}

/**
 * Decoded Asana envelope where successful `data` payloads may include `next_page` cursors for paging.
 */
export interface AsanaResponse<T = unknown> {
  data: T;
  next_page?: { offset?: string; uri?: string; path?: string } | null;
}

/**
 * Joins the fixed Asana API base URL with a path segment and optional query map for `fetch` URLs.
 */
function buildUrl(
  path: string,
  query?: Record<string, string | number | undefined>,
): string {
  const url = new URL(`${BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * Awaits a timer used between 429 retries and the single GID-mismatch re-read pause.
 */
async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pulls human-readable messages from Asana's `{ errors: [{ message }] }` shape or falls back to JSON.
 */
function extractErrorMessage(body: unknown): string {
  if (
    body &&
    typeof body === "object" &&
    "errors" in body &&
    Array.isArray((body as { errors: unknown[] }).errors)
  ) {
    const errs = (body as { errors: Array<{ message?: string }> }).errors;
    return errs.map((e) => e.message ?? "(unknown error)").join("; ");
  }
  return JSON.stringify(body);
}

/**
 * Low-level REST call. Most scripts use a helper wrapper, not this directly.
 */
export async function asanaFetch<T = unknown>(
  path: string,
  options: AsanaFetchOptions = {},
): Promise<AsanaResponse<T>> {
  const { pat } = loadAsanaEnv();
  const method = options.method ?? "GET";
  const url = buildUrl(path, options.query);

  const shouldWrap =
    options.wrapBody ?? (method === "POST" || method === "PUT" || method === "PATCH");
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/json",
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
  };
  if (options.body !== undefined) {
    init.body = JSON.stringify(shouldWrap ? { data: options.body } : options.body);
  }

  let attempt = 0;
  let gidMismatchRetries = 0;

  while (true) {
    attempt += 1;
    const response = await fetch(url, init);

    if (response.status === 429 && attempt <= MAX_RETRIES) {
      const retryAfter = response.headers.get("Retry-After");
      const waitMs = retryAfter
        ? Math.max(1000, Number.parseInt(retryAfter, 10) * 1000)
        : 2 ** attempt * 500;
      const attemptNote = `(attempt ${attempt}/${MAX_RETRIES})`;
      warn(`429 from Asana on ${path}; sleeping ${waitMs}ms ${dim(attemptNote)}`);
      await sleep(waitMs);
      continue;
    }

    let parsed: unknown = null;
    const text = await response.text();
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }
    }

    if (!response.ok) {
      throw new AsanaApiError(
        response.status,
        path,
        extractErrorMessage(parsed),
        parsed,
      );
    }

    const payload = parsed as AsanaResponse<T>;

    if (
      options.expectedGid !== undefined &&
      payload?.data &&
      typeof payload.data === "object" &&
      "gid" in (payload.data as Record<string, unknown>)
    ) {
      const returnedGid = (payload.data as Record<string, unknown>).gid;
      if (returnedGid !== options.expectedGid && gidMismatchRetries < 1) {
        warn(
          `GID mismatch on ${path}: expected ${options.expectedGid}, got ${String(returnedGid)}. Retrying once.`,
        );
        gidMismatchRetries += 1;
        await sleep(300);
        continue;
      }
    }

    return payload;
  }
}

// ---------- Typed helpers for the common surface ----------

/**
 * Minimal section record returned by project section create/list endpoints.
 */
export interface AsanaSection {
  gid: string;
  name: string;
  resource_type?: string;
}

/**
 * Lightweight task identity (GID + title) used where full task shapes are unnecessary.
 */
export interface AsanaTaskRef {
  gid: string;
  name: string;
}

/**
 * Creates a section within a project, optionally positioned relative to another section GID.
 */
export async function createSection(args: {
  projectGid: string;
  name: string;
  insertAfter?: string;
  insertBefore?: string;
}): Promise<AsanaSection> {
  const body: Record<string, unknown> = { name: args.name };
  if (args.insertAfter) body.insert_after = args.insertAfter;
  if (args.insertBefore) body.insert_before = args.insertBefore;
  const res = await asanaFetch<AsanaSection>(
    `/projects/${args.projectGid}/sections`,
    { method: "POST", body },
  );
  return res.data;
}

/**
 * Lists sections for a project with `name` and `resource_type` opt-in fields.
 */
export async function listSections(projectGid: string): Promise<AsanaSection[]> {
  const res = await asanaFetch<AsanaSection[]>(
    `/projects/${projectGid}/sections`,
    { method: "GET", query: { opt_fields: "name,resource_type" } },
  );
  return res.data;
}

/**
 * Adds or moves a task into a project's section via the `addProject` association endpoint.
 */
export async function moveTaskToSection(args: {
  taskGid: string;
  projectGid: string;
  sectionGid: string;
}): Promise<void> {
  await asanaFetch(`/tasks/${args.taskGid}/addProject`, {
    method: "POST",
    body: { project: args.projectGid, section: args.sectionGid },
  });
}

/**
 * Task row shape used by inventory helpers including completion and subtask counts when requested.
 */
export interface AsanaTaskInventory {
  gid: string;
  name: string;
  completed?: boolean;
  num_subtasks?: number;
}

/**
 * Paginates top-level tasks for a project, following `next_page.offset` until exhausted.
 */
export async function listTopLevelTasks(
  projectGid: string,
  optFields = "name,completed,num_subtasks",
): Promise<AsanaTaskInventory[]> {
  const all: AsanaTaskInventory[] = [];
  let offset: string | undefined;
  do {
    const res = await asanaFetch<AsanaTaskInventory[]>(`/tasks`, {
      method: "GET",
      query: {
        project: projectGid,
        limit: 100,
        opt_fields: optFields,
        ...(offset ? { offset } : {}),
      },
    });
    all.push(...res.data);
    offset = res.next_page?.offset ?? undefined;
  } while (offset);
  return all;
}

/**
 * Paginates direct subtasks for a parent task, following `next_page.offset` until exhausted.
 */
export async function listSubtasks(
  taskGid: string,
  optFields = "name,completed",
): Promise<AsanaTaskInventory[]> {
  const all: AsanaTaskInventory[] = [];
  let offset: string | undefined;
  do {
    const res = await asanaFetch<AsanaTaskInventory[]>(
      `/tasks/${taskGid}/subtasks`,
      {
        method: "GET",
        query: {
          limit: 100,
          opt_fields: optFields,
          ...(offset ? { offset } : {}),
        },
      },
    );
    all.push(...res.data);
    offset = res.next_page?.offset ?? undefined;
  } while (offset);
  return all;
}

/**
 * Parent or subtask record including optional dependency edges when `opt_fields` requests them.
 */
export interface AsanaTaskWithDeps {
  gid: string;
  name: string;
  dependencies?: Array<{ gid: string }>;
}

/**
 * Loads a parent task with `expectedGid` verification then hydrates subtasks including dependency GIDs.
 */
export async function getTaskWithSubtaskDeps(
  parentGid: string,
): Promise<{ parent: AsanaTaskWithDeps; subtasks: AsanaTaskWithDeps[] }> {
  const parentRes = await asanaFetch<AsanaTaskWithDeps>(`/tasks/${parentGid}`, {
    method: "GET",
    query: { opt_fields: "name" },
    expectedGid: parentGid,
  });
  const subs = await listSubtasks(parentGid, "name,dependencies.gid");
  // listSubtasks returns AsanaTaskInventory shape; widen by re-reading the field.
  const subtasks: AsanaTaskWithDeps[] = subs.map((s) => ({
    gid: s.gid,
    name: s.name,
    dependencies: (s as unknown as AsanaTaskWithDeps).dependencies ?? [],
  }));
  return { parent: parentRes.data, subtasks };
}

/**
 * Bulk-adds blocking dependencies; no-ops when the dependency list is empty to avoid useless POSTs.
 */
export async function addDependencies(args: {
  taskGid: string;
  dependencies: string[];
}): Promise<void> {
  if (args.dependencies.length === 0) return;
  await asanaFetch(`/tasks/${args.taskGid}/addDependencies`, {
    method: "POST",
    body: { dependencies: args.dependencies },
  });
}

// ---------- Attachments ----------

/**
 * Shape returned by `GET /tasks/{task_gid}/attachments` and the immediate
 * response from `POST /tasks/{task_gid}/attachments`. Note: `size`, `view_url`,
 * `download_url`, and `permanent_url` can be `null` on the immediate POST
 * response — they populate after server processing. Re-list to confirm.
 */
export interface AsanaAttachment {
  gid: string;
  name: string;
  size?: number | null;
  view_url?: string | null;
  download_url?: string | null;
  permanent_url?: string | null;
  created_at?: string;
  resource_subtype?: string;
  resource_type?: string;
  parent?: { gid: string; name?: string; resource_type?: string } | null;
}

/**
 * List attachments on a task. Wraps `GET /tasks/{task_gid}/attachments`.
 * The MCP `get_attachments` tool covers the same surface; this helper exists
 * so attachment scripts can stay self-contained without an MCP round-trip.
 */
export async function listAttachments(
  taskGid: string,
  optFields = "name,size,created_at,resource_subtype,view_url,download_url,permanent_url",
): Promise<AsanaAttachment[]> {
  const all: AsanaAttachment[] = [];
  let offset: string | undefined;
  do {
    const res = await asanaFetch<AsanaAttachment[]>(
      `/tasks/${taskGid}/attachments`,
      {
        method: "GET",
        query: {
          limit: 100,
          opt_fields: optFields,
          ...(offset ? { offset } : {}),
        },
      },
    );
    all.push(...res.data);
    offset = res.next_page?.offset ?? undefined;
  } while (offset);
  return all;
}

/**
 * Upload a local file as a task attachment. Wraps
 * `POST /tasks/{task_gid}/attachments` with `multipart/form-data`. The MCP
 * surface has NO upload tool — REST is the only path.
 *
 * Returns the new attachment record. `size` / URLs may be `null` immediately
 * after upload; call `listAttachments` to confirm processed state.
 *
 * Idempotency: this function does NOT check for duplicates. Callers that want
 * "upload-once" semantics must list current attachments first and skip when a
 * name+size match is already present. See `scripts/upload-attachment.ts` for
 * the `--skip-if-exists` flow.
 */
export async function uploadAttachment(args: {
  taskGid: string;
  filePath: string;
  /** Display name for the attachment. Defaults to the file's basename. */
  displayName?: string;
  /** Optional MIME type. Defaults to `application/octet-stream`. */
  contentType?: string;
}): Promise<AsanaAttachment> {
  const { pat } = loadAsanaEnv();

  const fileBuffer = await readFile(args.filePath);
  const displayName = args.displayName ?? basename(args.filePath);
  const contentType = args.contentType ?? "application/octet-stream";

  // Node 20+ has native FormData and Blob.
  const form = new FormData();
  // Use a Blob with the requested content type. The third FormData arg sets
  // the filename slot of the multipart payload, which Asana uses as the
  // attachment display name when no `name` field is sent separately.
  const blob = new Blob([new Uint8Array(fileBuffer)], { type: contentType });
  form.append("file", blob, displayName);

  const url = `${BASE_URL}/tasks/${args.taskGid}/attachments`;

  let attempt = 0;
  while (true) {
    attempt += 1;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/json",
        // NOTE: do NOT set Content-Type here — `fetch` adds the multipart
        // boundary automatically when the body is a FormData instance.
      },
      body: form,
    });

    if (response.status === 429 && attempt <= MAX_RETRIES) {
      const retryAfter = response.headers.get("Retry-After");
      const waitMs = retryAfter
        ? Math.max(1000, Number.parseInt(retryAfter, 10) * 1000)
        : 2 ** attempt * 500;
      const attemptNote = `(attempt ${attempt}/${MAX_RETRIES})`;
      warn(
        `429 from Asana on POST attachments; sleeping ${waitMs}ms ${dim(attemptNote)}`,
      );
      await sleep(waitMs);
      continue;
    }

    const text = await response.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }
    }

    if (!response.ok) {
      throw new AsanaApiError(
        response.status,
        `/tasks/${args.taskGid}/attachments`,
        extractErrorMessage(parsed),
        parsed,
      );
    }

    const payload = parsed as AsanaResponse<AsanaAttachment>;
    return payload.data;
  }
}

/**
 * Delete an attachment by GID. Wraps `DELETE /attachments/{attachment_gid}`.
 * Asana returns `{"data":{}}` on success. The MCP surface has NO delete tool
 * for attachments — REST is the only path.
 */
export async function deleteAttachment(attachmentGid: string): Promise<void> {
  await asanaFetch(`/attachments/${attachmentGid}`, { method: "DELETE" });
}
