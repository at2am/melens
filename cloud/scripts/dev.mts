/**
 * The local development stack in one command: builds `cloud/map` and
 * `cloud/agent`, then runs the map service on 8081 and the agent service on
 * 8080 with the reviewed development settings (cloud/agent/README.md, Local
 * commands; cloud/map/infra/README.md for the scan ceiling). Ctrl-C stops
 * both; when one exits on its own the other is stopped too.
 *
 *   cd cloud && npm run dev
 *   npm run dev -- --no-build        # reuse the last build
 *   AGENT_PORT=8083 npm run dev      # move a service; MAP_PORT likewise
 *
 * Any variable a service reads can be set in the environment and overrides
 * the default here, for example AGENT_MODEL or MELENS_PROJECT_ID. The
 * services need Application Default Credentials for the project
 * (`gcloud auth application-default login`); without them the map layers
 * report unavailable and every agent turn fails with a retryable error.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

interface Service {
  readonly name: string;
  readonly cwd: string;
  readonly entry: string;
  readonly port: number;
  readonly health: string;
  readonly env: Readonly<Record<string, string>>;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const projectId = env.MELENS_PROJECT_ID ?? env.AGENT_PROJECT_ID ?? env.MAP_PROJECT_ID ?? 'melens-510012';
/** The origin the Flutter Web app runs on (`fvm flutter run --web-port 8000`); both services allow it for CORS. */
const appOrigin = env.MELENS_APP_ORIGIN ?? 'http://localhost:8000';
const publicSources = resolve(root, 'map/infra/dev-public-sources.json');
/** The reviewed development ceiling for current-mode geo queries; the library default of 100 MB blocks every layer. */
const dynamicScanBytes = '1000000000';

function port(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) throw new RangeError(`Not a port: ${value}`);
  return parsed;
}

const services: readonly Service[] = [
  {
    name: 'map', cwd: resolve(root, 'map'), entry: 'dist/src/server.js', port: port(env.MAP_PORT, 8081), health: '/healthz',
    env: { MAP_PROJECT_ID: projectId, MAP_ALLOWED_ORIGINS: appOrigin, MAP_PUBLIC_SOURCES_FILE: publicSources, MAP_DYNAMIC_SCAN_BYTES: dynamicScanBytes },
  },
  {
    name: 'agent', cwd: resolve(root, 'agent'), entry: 'dist/src/main.js', port: port(env.AGENT_PORT, 8080), health: '/healthz',
    env: { AGENT_PROJECT_ID: projectId, AGENT_VERTEX_LOCATION: 'global', AGENT_ALLOWED_ORIGINS: appOrigin, AGENT_PUBLIC_SOURCES_FILE: publicSources,
      MAP_DYNAMIC_SCAN_BYTES: dynamicScanBytes, AGENT_DEVELOPMENT_MODE: 'true', AGENT_DEVELOPMENT_TOKEN: 'dev', AGENT_ROUTES_QUOTA_PROJECT: projectId },
  },
];

const say = (line: string): void => { process.stdout.write(`[dev] ${line}\n`); };

function portFree(value: number): Promise<boolean> {
  return new Promise((done) => {
    const probe = createServer();
    probe.once('error', () => done(false));
    probe.listen(value, '0.0.0.0', () => probe.close(() => done(true)));
  });
}

/** Best effort, macOS and Linux: the pid listening on the port, for the error message. */
function listenerOf(value: number): string {
  const result = spawnSync('lsof', ['-ti', `tcp:${value}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  const pid = result.status === 0 ? result.stdout.trim().split('\n')[0] : '';
  return pid === '' || pid === undefined ? 'another process' : `pid ${pid}`;
}

async function main(): Promise<void> {
  for (const service of services) {
    if (!(await portFree(service.port))) {
      say(`port ${service.port} for the ${service.name} service is in use by ${listenerOf(service.port)}; stop it or set ${service.name.toUpperCase()}_PORT`);
      process.exitCode = 1;
      return;
    }
  }
  if (!process.argv.includes('--no-build')) {
    say('building map and agent (npm run build)');
    const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
    if (build.status !== 0) { process.exitCode = build.status ?? 1; return; }
  }

  const children = new Map<string, ChildProcess>();
  let stopping = false;
  const stop = (code: number): void => {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    for (const child of children.values()) child.kill('SIGTERM');
    setTimeout(() => { for (const child of children.values()) child.kill('SIGKILL'); }, 5_000).unref();
  };
  process.once('SIGINT', () => { say('stopping'); stop(0); });
  process.once('SIGTERM', () => stop(0));

  for (const service of services) {
    const child = spawn(process.execPath, [service.entry], {
      cwd: service.cwd, env: { ...service.env, ...env, PORT: String(service.port) }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.set(service.name, child);
    const prefix = `[${service.name}]`;
    createInterface({ input: child.stdout! }).on('line', (line) => process.stdout.write(`${prefix} ${line}\n`));
    createInterface({ input: child.stderr! }).on('line', (line) => process.stderr.write(`${prefix} ${line}\n`));
    child.once('exit', (code, signal) => {
      children.delete(service.name);
      if (!stopping) {
        say(`the ${service.name} service exited (${signal ?? `code ${code}`}); stopping the rest`);
        stop(code ?? 1);
      }
    });
  }
  say(`project ${projectId}, app origin ${appOrigin}`);
  for (const service of services) say(`${service.name}: http://localhost:${service.port}${service.health}`);
  say('Flutter: set AGENT_BASE_URL and MAP_BASE_URL in app/config/dev.json to these ports, AGENT_DEV_TOKEN to dev, and run with --web-port 8000');
}

void main();
