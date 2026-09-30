import { access, cp, readdir } from 'node:fs/promises';
const sourceRoot = new URL('../src/connectors/', import.meta.url);
const targetRoot = new URL('../dist/src/connectors/', import.meta.url);
for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  await cp(new URL(`${entry.name}/source.json`, sourceRoot), new URL(`${entry.name}/source.json`, targetRoot));
}
const fixtures = new URL('../test/fixtures/', import.meta.url);
try {
  await access(fixtures);
  await cp(fixtures, new URL('../dist/test/fixtures/', import.meta.url), { recursive: true });
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
