const DEFAULT_PROVIDER_TIMEOUT_MS = 60_000;

export function providerFetch(fetchImpl = fetch, timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS) {
  return (resource, init = {}) => fetchImpl(resource, {
    ...init,
    signal: init.signal || AbortSignal.timeout(timeoutMs),
  });
}
