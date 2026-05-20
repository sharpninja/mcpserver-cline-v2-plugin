import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import type { ReplBridge } from '../transport/repl-bridge.js';

interface FailsafeEntry {
  id: string;
  timestamp: string;
  method: string;
  params?: Record<string, unknown>;
  retryCount: number;
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9._=-]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'operation';
}

function failsafeDir(): string {
  return (
    process.env.MCPSERVER_FAILSAFE_DIR ||
    process.env.MCP_FAILSAFE_DIR ||
    path.join(os.tmpdir(), 'mcpserver-cline-v2-plugin', 'failsafe')
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function listYamlFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((entry) => /\.ya?ml$/i.test(entry)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function cacheWrite(method: string, params?: Record<string, unknown>): Promise<string> {
  const dir = failsafeDir();
  await fs.mkdir(dir, { recursive: true });

  const id = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const entry: FailsafeEntry = {
    id,
    timestamp: new Date().toISOString(),
    method,
    params,
    retryCount: 0,
  };
  const filePath = path.join(dir, `${id}-${sanitize(method)}.yaml`);
  await fs.writeFile(filePath, yaml.dump(entry, { lineWidth: -1, noRefs: true }), 'utf8');
  return filePath;
}

export async function cacheDelete(filePath: string): Promise<void> {
  await fs.rm(filePath, { force: true });
}

export async function cacheFlush(
  bridge: ReplBridge,
): Promise<{ flushed: number; failed: number; pending: number }> {
  const dir = failsafeDir();
  const files = await listYamlFiles(dir);
  let flushed = 0;
  let failed = 0;

  for (const file of files) {
    const filePath = path.join(dir, file);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const entry = asRecord(yaml.load(raw));
      const method = typeof entry?.method === 'string' ? entry.method : '';
      if (!method) throw new Error(`Failsafe entry ${file} has no method.`);

      const params = asRecord(entry?.params);
      const response = await bridge.invoke(method, params);
      if (response.type === 'error') {
        failed += 1;
        continue;
      }

      await cacheDelete(filePath);
      flushed += 1;
    } catch {
      failed += 1;
    }
  }

  const pending = (await listYamlFiles(dir)).length;
  return { flushed, failed, pending };
}
