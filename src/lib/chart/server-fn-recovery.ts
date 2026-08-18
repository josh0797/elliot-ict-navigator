/**
 * Recovery for client/server build desynchronisation.
 *
 * TanStack Start compiles every `createServerFn` into a hashed RPC id. When the
 * loaded client bundle was produced by a different build than the deployed
 * server bundle, the client posts an id the server manifest does not contain
 * and the response is `Server function info not found for <hash>`.
 *
 * Retrying the same call cannot fix it: the only recovery is loading the
 * current document (and therefore the current bundle) exactly once. The
 * sessionStorage guard is keyed by build id so a reload loop is impossible.
 */

export const DESYNC_MESSAGE =
  "La aplicación se actualizó, pero el cliente y el servidor siguen desincronizados. Vuelve a publicar la versión.";

const GUARD_KEY = "serverfn-desync-reload";

/** True only for the build-desync error — never for network/transient errors. */
export function isServerFnDesyncError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /server function info not found/i.test(message);
}

export interface RecoveryHost {
  storage: Pick<Storage, "getItem" | "setItem">;
  reload: () => void;
  buildId: string;
}

export type RecoveryOutcome =
  | { action: "reloaded" }
  | { action: "blocked"; message: string };

/**
 * At most ONE full reload per build id. If the same build already reloaded,
 * surface the operator-facing message instead of reloading again. The internal
 * hash is never shown.
 */
export function recoverFromServerFnDesync(host: RecoveryHost): RecoveryOutcome {
  let previous: string | null = null;
  try {
    previous = host.storage.getItem(GUARD_KEY);
  } catch {
    previous = null;
  }
  if (previous === host.buildId) return { action: "blocked", message: DESYNC_MESSAGE };
  try {
    host.storage.setItem(GUARD_KEY, host.buildId);
  } catch {
    /* storage unavailable — still attempt a single reload */
  }
  host.reload();
  return { action: "reloaded" };
}

/** Clear the guard once a snapshot loaded successfully on this build. */
export function clearDesyncGuard(storage: Pick<Storage, "removeItem">): void {
  try {
    storage.removeItem(GUARD_KEY);
  } catch {
    /* ignore */
  }
}