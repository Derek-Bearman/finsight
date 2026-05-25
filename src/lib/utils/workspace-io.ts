/**
 * JSON workspace export / import.
 *
 * Pure functions for serializing a ClientWorkspace to a portable .json
 * file and parsing one back. Used as a stop-gap persistence solution
 * before Supabase lands — lets users move workspaces between machines,
 * back them up, or share with a colleague.
 *
 * The export wraps the workspace in a versioned envelope so future schema
 * changes can be detected and migrated. Importing an envelope with an
 * unknown future version returns a clear error.
 */

import type { ClientWorkspace } from '@/types';

/** File format identifier — distinguishes our JSON from arbitrary JSON files. */
export const FINSIGHT_EXPORT_FORMAT = 'finsight-workspace';

/** Current export schema version. Bump when ClientWorkspace shape changes incompatibly. */
export const FINSIGHT_EXPORT_VERSION = 1;

/** Top-level shape written to disk and parsed back. */
export interface WorkspaceExportEnvelope {
  format: typeof FINSIGHT_EXPORT_FORMAT;
  version: number;
  exportedAt: string; // ISO 8601 timestamp
  app: {
    name: 'FinSight';
    /** Build / app version, useful for debugging cross-version issues */
    version?: string;
  };
  workspace: ClientWorkspace;
}

// ─────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────

/**
 * Serialize a workspace to a pretty-printed JSON string ready to download.
 * The envelope's `exportedAt` is set to the current time.
 */
export function exportWorkspaceJSON(workspace: ClientWorkspace): string {
  const envelope: WorkspaceExportEnvelope = {
    format: FINSIGHT_EXPORT_FORMAT,
    version: FINSIGHT_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    app: { name: 'FinSight' },
    workspace,
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * Returns a filesystem-safe filename for a workspace export.
 * Example: "Bluefin_Plumbing_2026-05-24.finsight.json"
 */
export function workspaceExportFilename(workspace: ClientWorkspace): string {
  const safeName = workspace.name
    .replace(/[^a-zA-Z0-9-_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  const date = new Date().toISOString().slice(0, 10);
  return `${safeName || 'workspace'}_${date}.finsight.json`;
}

/**
 * Browser-only helper: trigger a download of the workspace JSON.
 * No-op when called server-side.
 */
export function downloadWorkspaceJSON(workspace: ClientWorkspace): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const json = exportWorkspaceJSON(workspace);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = workspaceExportFilename(workspace);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Free the object URL after a short delay so the download has time to kick off
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─────────────────────────────────────────────
// Import
// ─────────────────────────────────────────────

export type ImportResult =
  | { ok: true; workspace: ClientWorkspace; warnings: string[] }
  | { ok: false; error: string };

/**
 * Parse and validate a JSON string into a ClientWorkspace.
 *
 * Accepts either:
 *   - A wrapped envelope (the format `exportWorkspaceJSON` produces)
 *   - A bare ClientWorkspace object (legacy / hand-edited files)
 *
 * Returns warnings (non-fatal) for things like missing optional fields,
 * unknown schema version (we attempt the import anyway), or a workspace
 * that was clearly exported from a future build.
 */
export function parseWorkspaceJSON(text: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown JSON parse error';
    return { ok: false, error: `File is not valid JSON: ${msg}` };
  }

  if (parsed === null || typeof parsed !== 'object') {
    return { ok: false, error: 'File does not contain a JSON object.' };
  }

  const warnings: string[] = [];
  const obj = parsed as Record<string, unknown>;

  // Detect format: envelope vs. bare workspace
  let candidateWorkspace: unknown;
  if (obj.format === FINSIGHT_EXPORT_FORMAT) {
    const version = obj.version;
    if (typeof version === 'number' && version > FINSIGHT_EXPORT_VERSION) {
      warnings.push(
        `Workspace was exported by a newer version of FinSight (v${version}). ` +
          `This build supports up to v${FINSIGHT_EXPORT_VERSION}. Some fields may be missing.`
      );
    }
    candidateWorkspace = obj.workspace;
  } else if ('id' in obj && 'accounts' in obj) {
    // Looks like a bare workspace
    candidateWorkspace = obj;
    warnings.push(
      'File appears to be a raw workspace (no FinSight export envelope). ' +
        'Importing as-is; some metadata may be missing.'
    );
  } else {
    return {
      ok: false,
      error:
        'File does not look like a FinSight workspace export. ' +
        'Expected a JSON file with `format: "finsight-workspace"` at the top level.',
    };
  }

  // Structural validation of the workspace
  const validation = validateWorkspaceShape(candidateWorkspace);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  const workspace = validation.workspace;

  // Fill in any optional fields that older exports might be missing
  const normalized: ClientWorkspace = {
    ...workspace,
    scenarios: workspace.scenarios ?? [],
    operationalData: workspace.operationalData ?? [],
    customMetrics: workspace.customMetrics ?? [],
    auditLog: workspace.auditLog ?? [],
    fiscalYearStart: workspace.fiscalYearStart ?? 1,
    createdAt: workspace.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return { ok: true, workspace: normalized, warnings };
}

/**
 * Returns true if `value` is a non-null object (i.e. usable as a record).
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

interface ShapeOk {
  ok: true;
  workspace: ClientWorkspace;
}
interface ShapeErr {
  ok: false;
  error: string;
}

/**
 * Light structural check — verifies the top-level required fields are
 * present and roughly the right type. We deliberately don't fully validate
 * every nested account / value / scenario; the import just needs to be
 * "shaped like a workspace" — render errors will surface anything weird.
 */
function validateWorkspaceShape(value: unknown): ShapeOk | ShapeErr {
  if (!isObject(value)) {
    return { ok: false, error: 'Workspace data is not an object.' };
  }
  const requiredStringFields = ['id', 'name', 'industryProfileId'];
  for (const field of requiredStringFields) {
    if (typeof value[field] !== 'string' || value[field] === '') {
      return { ok: false, error: `Workspace is missing required field "${field}".` };
    }
  }
  if (!Array.isArray(value.accounts)) {
    return { ok: false, error: 'Workspace "accounts" must be an array.' };
  }
  if (!Array.isArray(value.values)) {
    return { ok: false, error: 'Workspace "values" must be an array.' };
  }

  // The type cast is justified by the above checks plus the optional-field
  // fill-in done by the caller.
  return { ok: true, workspace: value as unknown as ClientWorkspace };
}

/**
 * Given an existing list of workspace ids and the imported workspace's id,
 * returns an id that is guaranteed not to collide.
 *  - If `incomingId` doesn't conflict, returns it unchanged.
 *  - Otherwise appends a timestamp suffix to make it unique.
 */
export function resolveWorkspaceIdCollision(
  incomingId: string,
  existingIds: ReadonlySet<string>
): { id: string; renamed: boolean } {
  if (!existingIds.has(incomingId)) {
    return { id: incomingId, renamed: false };
  }
  // Generate a deterministic-ish unique id
  const suffix = `imported-${Date.now().toString(36)}`;
  let candidate = `${incomingId}-${suffix}`;
  // Belt-and-suspenders: if even THAT collides, add a random tail
  while (existingIds.has(candidate)) {
    candidate = `${incomingId}-${suffix}-${Math.random().toString(36).slice(2, 7)}`;
  }
  return { id: candidate, renamed: true };
}
