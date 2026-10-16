export function loopbackOrigin(value, label = 'Local service URL') {
  let address;
  try { address = new URL(value); }
  catch { throw new Error(`${label} must be a valid HTTP loopback origin.`); }
  if (address.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(address.hostname)
    || address.username || address.password || address.pathname !== '/' || address.search || address.hash) {
    throw new Error(`${label} must be an HTTP loopback origin without credentials, a path, or a query.`);
  }
  return address.origin;
}

export const localTargets = Object.freeze({
  live: loopbackOrigin(process.env.E2E_LIVE_URL ?? 'http://localhost:8000', 'E2E_LIVE_URL'),
  sample: loopbackOrigin(process.env.E2E_SAMPLE_URL ?? 'http://localhost:8001', 'E2E_SAMPLE_URL'),
  agent: loopbackOrigin(process.env.E2E_AGENT_URL ?? 'http://localhost:8080', 'E2E_AGENT_URL'),
  map: loopbackOrigin(process.env.E2E_MAP_URL ?? 'http://localhost:8081', 'E2E_MAP_URL'),
});
