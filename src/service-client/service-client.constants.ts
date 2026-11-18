/**
 * How long a call through a service client waits before it gives up, in
 * milliseconds. axios waits forever by default, so a service that hangs
 * would hold the caller's request until the platform's own timeout.
 * A client created with its own `timeout` keeps it.
 */
export const SERVICE_CLIENT_TIMEOUT_MS = 30_000;
