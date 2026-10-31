// Plain-word labels shared by the Worker (overview, digest) and the front end.

/** Supabase project states in plain words. */
export function supabaseStatus(status: string): string {
  const labels: Record<string, string> = {
    ACTIVE_HEALTHY: "healthy",
    ACTIVE_UNHEALTHY: "unhealthy",
    INACTIVE: "paused",
    PAUSING: "pausing",
    COMING_UP: "starting",
    RESTORING: "restoring",
    UPGRADING: "upgrading",
    GOING_DOWN: "stopping",
    INIT_FAILED: "failed to start",
    REMOVED: "removed",
  };
  return labels[status] ?? status.toLowerCase().replace(/_/g, " ");
}
