import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';

export interface MemoryInjection {
  requiredMemoriesPrefix: string;
  emptyFallback: string;
}

export interface MemoryFallback {
  localFailsafe: boolean;
  replayAfterAck: boolean;
}

export interface MemoryDescriptor {
  host: string;
  path: string;
  loaded: boolean;
  injection: MemoryInjection;
  fallback: MemoryFallback;
  tools: string[];
  workflowMethods: Record<string, string>;
}

export interface MemoryItem {
  id: string;
  text: string;
}

export interface MemoryFetchBridge {
  invoke(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

export interface RequiredMemoryOptions {
  pluginRoot?: string;
  descriptorPath?: string;
  fetchOverride?: () => string | Promise<string>;
  bridge?: MemoryFetchBridge;
  host?: string;
}

const DEFAULT_PREFIX = 'REQUIRED MEMORIES -';
const DEFAULT_EMPTY = 'REQUIRED MEMORIES - None.';
const REQUEST_BOUNDARY_TOOLS = new Set(['session_begin_turn']);

function defaultHost(explicit?: string): string {
  return (
    explicit ||
    process.env.MCP_PLUGIN_HOST ||
    process.env.MCP_MEMORY_HOST ||
    'cline-v2'
  );
}

export function getMemoryPluginRoot(pluginRoot?: string): string {
  const candidates = [
    pluginRoot,
    process.env.MCP_PLUGIN_ROOT,
    process.env.MCPSERVER_PLUGIN_ROOT,
    process.env.CLAUDE_PLUGIN_ROOT,
    process.env.CLINE_PLUGIN_ROOT,
  ].filter((value): value is string => !!value && value.trim().length > 0);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return path.resolve(candidate);
    }
  }

  const fromArgv = process.argv[1] ? path.resolve(path.dirname(process.argv[1]), '..') : undefined;
  if (fromArgv && fs.existsSync(fromArgv) && fs.statSync(fromArgv).isDirectory()) {
    const descriptor = path.join(fromArgv, 'memory-descriptor.json');
    if (fs.existsSync(descriptor)) return fromArgv;
  }

  return path.resolve(process.cwd());
}

export function getMemoryDescriptorPath(pluginRoot?: string, descriptorPath?: string): string {
  if (descriptorPath && descriptorPath.trim()) return descriptorPath;
  if (process.env.MCP_MEMORY_DESCRIPTOR_PATH) return process.env.MCP_MEMORY_DESCRIPTOR_PATH;
  return path.join(getMemoryPluginRoot(pluginRoot), 'memory-descriptor.json');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringProp(value: unknown, name: string): string | undefined {
  const record = asRecord(value);
  const raw = record[name];
  return typeof raw === 'string' && raw.trim() ? raw : undefined;
}

function boolProp(value: unknown, name: string): boolean {
  const record = asRecord(value);
  return record[name] === true;
}

export function loadMemoryDescriptor(options: RequiredMemoryOptions = {}): MemoryDescriptor {
  const host = defaultHost(options.host);
  const descriptorPath = getMemoryDescriptorPath(options.pluginRoot, options.descriptorPath);
  const empty: MemoryDescriptor = {
    host,
    path: descriptorPath,
    loaded: false,
    injection: {
      requiredMemoriesPrefix: DEFAULT_PREFIX,
      emptyFallback: DEFAULT_EMPTY,
    },
    fallback: {
      localFailsafe: true,
      replayAfterAck: true,
    },
    tools: [],
    workflowMethods: {},
  };

  if (!fs.existsSync(descriptorPath) || !fs.statSync(descriptorPath).isFile()) {
    return empty;
  }

  const json = JSON.parse(fs.readFileSync(descriptorPath, 'utf8')) as Record<string, unknown>;
  const injection = asRecord(json.injection);
  const fallback = asRecord(json.fallback);
  const tools = Array.isArray(json.tools) ? json.tools.map((tool) => String(tool)) : [];
  const workflowMethods: Record<string, string> = {};
  const rawMethods = asRecord(json.workflowMethods);
  for (const [name, method] of Object.entries(rawMethods)) {
    if (typeof method === 'string' && method.trim()) {
      workflowMethods[name] = method;
    }
  }
  if (Object.keys(workflowMethods).length === 0) {
    for (const tool of tools) {
      const match = /^memory_(.+)$/.exec(tool);
      if (match) workflowMethods[tool] = `workflow.memory.${match[1]}`;
    }
  }

  return {
    host: stringProp(json, 'host') || host,
    path: descriptorPath,
    loaded: true,
    injection: {
      requiredMemoriesPrefix: stringProp(injection, 'requiredMemoriesPrefix') || DEFAULT_PREFIX,
      emptyFallback: stringProp(injection, 'emptyFallback') || DEFAULT_EMPTY,
    },
    fallback: {
      localFailsafe: Object.prototype.hasOwnProperty.call(fallback, 'localFailsafe')
        ? boolProp(fallback, 'localFailsafe')
        : true,
      replayAfterAck: Object.prototype.hasOwnProperty.call(fallback, 'replayAfterAck')
        ? boolProp(fallback, 'replayAfterAck')
        : true,
    },
    tools,
    workflowMethods,
  };
}

export function resolveMemoryWorkflowMethod(name: string, descriptor?: MemoryDescriptor): string {
  const trimmed = name.trim();
  if (/^workflow\.memory\.[A-Za-z][A-Za-z0-9]*$/.test(trimmed)) {
    return trimmed;
  }
  if (descriptor?.workflowMethods[trimmed]) {
    return descriptor.workflowMethods[trimmed];
  }
  const match = /^memory_(.+)$/.exec(trimmed);
  if (match) {
    return `workflow.memory.${match[1]}`;
  }
  throw new Error(`Unsupported memory tool alias: ${name}`);
}

function pickItems(node: unknown): unknown[] {
  if (Array.isArray(node)) return node;
  const record = asRecord(node);
  if (Array.isArray(record.items)) return record.items;
  if (Array.isArray(record.Items)) return record.Items;
  return [];
}

function unwrapMemoryPayload(payload: unknown): unknown[] {
  const root = asRecord(payload);
  let node: unknown = payload;
  if (root.payload) node = root.payload;
  const afterPayload = asRecord(node);
  if (afterPayload.result) node = afterPayload.result;
  const afterResult = asRecord(node);
  if (afterResult.result) node = afterResult.result;
  return pickItems(node);
}

function parseMemoryPayload(response: string): unknown {
  const trimmed = response.trim();
  if (!trimmed) return null;
  try {
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return JSON.parse(trimmed);
    }
  } catch {
    // fall through to YAML
  }
  try {
    return yaml.load(trimmed);
  } catch {
    return null;
  }
}

function itemFromUnknown(item: unknown): MemoryItem | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const record = asRecord(item);
  const id = record.id ?? record.Id;
  const text = record.text ?? record.Text;
  if (typeof id !== 'string' || !id.trim() || text == null) return undefined;
  return { id: String(id), text: String(text) };
}

function parseMemoryItemsFromLines(response: string): MemoryItem[] {
  const items: MemoryItem[] = [];
  let currentId = '';
  let currentText = '';
  for (const line of response.split(/\r?\n/)) {
    const idMatch = line.match(/^\s*-?\s*[Ii]d:\s*(.+)$/);
    if (idMatch) {
      if (currentId) items.push({ id: currentId, text: currentText });
      currentId = idMatch[1].trim().replace(/^["']|["']$/g, '');
      currentText = '';
      continue;
    }
    const textMatch = line.match(/^\s*[Tt]ext:\s*(.*)$/);
    if (textMatch) {
      currentText = textMatch[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  if (currentId) items.push({ id: currentId, text: currentText });
  return items;
}

export function convertToMemoryItems(response: unknown): MemoryItem[] {
  if (response == null) return [];
  if (Array.isArray(response)) {
    return response.map(itemFromUnknown).filter((item): item is MemoryItem => !!item);
  }
  if (typeof response === 'object') {
    return unwrapMemoryPayload(response)
      .map(itemFromUnknown)
      .filter((item): item is MemoryItem => !!item);
  }

  const text = String(response);
  const payload = parseMemoryPayload(text);
  if (payload != null) {
    const items = unwrapMemoryPayload(payload)
      .map(itemFromUnknown)
      .filter((item): item is MemoryItem => !!item);
    if (items.length > 0) return items;
  }
  return parseMemoryItemsFromLines(text);
}

export function formatRequiredMemoryContext(
  descriptor: MemoryDescriptor | undefined,
  items: MemoryItem[],
): string {
  const prefix = descriptor?.injection.requiredMemoriesPrefix || DEFAULT_PREFIX;
  const empty = descriptor?.injection.emptyFallback || DEFAULT_EMPTY;
  const rows = items.filter((item) => item && item.id.trim());
  if (rows.length === 0) return empty;

  return rows
    .map((row) => {
      const normalized = row.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const [first, ...rest] = normalized.split('\n');
      const head = `${prefix.replace(/\s+$/, '')} ${row.id}: ${first}`;
      return rest.length > 0 && rest.join('\n') ? `${head}\n${rest.join('\n')}` : head;
    })
    .join('\n');
}

function appendReplLog(method: string, params: Record<string, unknown>): void {
  const logPath = process.env.MCP_PLUGIN_REPL_LOG;
  if (!logPath) return;
  const paramsYaml = Object.entries(params)
    .map(([key, value]) => `  ${key}: ${value}`)
    .join('\n');
  const entry = [`method: ${method}`, 'params: |', paramsYaml, '---'].join('\n');
  fs.appendFileSync(logPath, `${entry}\n`);
}

export async function fetchRequiredMemoryResponse(options: RequiredMemoryOptions = {}): Promise<string> {
  if (process.env.MCP_MEMORY_FETCH_ERROR === '1') {
    throw new Error('MCP_MEMORY_FETCH_ERROR is set');
  }
  if (options.fetchOverride) {
    return String(await options.fetchOverride());
  }
  if (process.env.MCP_PLUGIN_REPL_LOG) {
    appendReplLog('workflow.memory.list', { scope: 'Effective' });
    if (process.env.MCP_MEMORY_REPL_RESPONSE) return process.env.MCP_MEMORY_REPL_RESPONSE;
    if (process.env.MCP_PLUGIN_REPL_RESPONSE) return process.env.MCP_PLUGIN_REPL_RESPONSE;
    return '';
  }
  if (process.env.MCP_MEMORY_REPL_RESPONSE) {
    return process.env.MCP_MEMORY_REPL_RESPONSE;
  }
  if (options.bridge) {
    const response = await options.bridge.invoke('workflow.memory.list', { scope: 'Effective' });
    if (typeof response === 'string') return response;
    return JSON.stringify(response ?? '');
  }
  throw new Error('No memory fetch path available');
}

export async function getRequiredMemoryItems(options: RequiredMemoryOptions = {}): Promise<MemoryItem[]> {
  const response = await fetchRequiredMemoryResponse(options);
  return convertToMemoryItems(response);
}

export async function getRequiredMemoryContext(options: RequiredMemoryOptions = {}): Promise<string> {
  let descriptor: MemoryDescriptor | undefined;
  try {
    descriptor = loadMemoryDescriptor(options);
  } catch (error) {
    process.stderr.write(
      `required-memory descriptor load failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    descriptor = undefined;
  }

  try {
    const items = await getRequiredMemoryItems(options);
    return formatRequiredMemoryContext(descriptor, items);
  } catch (error) {
    process.stderr.write(
      `required-memory injection skipped: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return descriptor?.injection.emptyFallback || DEFAULT_EMPTY;
  }
}

export function isRequestBoundaryTool(name: string): boolean {
  return REQUEST_BOUNDARY_TOOLS.has(name);
}

export function attachRequiredMemoryToResult<T>(result: T, context: string): T {
  if (!context.trim()) return result;
  if (!result || typeof result !== 'object') {
    return { value: result, requiredMemories: context } as T;
  }

  const record = result as Record<string, unknown>;
  if (Array.isArray(record.content)) {
    const content = [...(record.content as Array<Record<string, unknown>>)];
    const first = content[0];
    if (first && first.type === 'text' && typeof first.text === 'string') {
      if (first.text.includes(context)) {
        return { ...record, requiredMemories: context } as T;
      }
      let nextText = `${context}\n\n${first.text}`;
      try {
        const parsed = JSON.parse(first.text) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          parsed.requiredMemories = context;
          nextText = `${context}\n\n${JSON.stringify(parsed, null, 2)}`;
        }
      } catch {
        // keep prepended raw text
      }
      content[0] = { ...first, text: nextText };
      return { ...record, content, requiredMemories: context } as T;
    }
  }

  if (typeof record.requiredMemories === 'string' && record.requiredMemories.includes(context)) {
    return result;
  }
  return { ...record, requiredMemories: context } as T;
}

export async function withRequiredMemoryInjection<T>(
  name: string,
  result: T,
  options: RequiredMemoryOptions = {},
): Promise<T> {
  if (!isRequestBoundaryTool(name)) return result;
  const context = await getRequiredMemoryContext(options);
  return attachRequiredMemoryToResult(result, context);
}

export function mergeRequiredMemoryIntoParts(
  parts: Array<Record<string, unknown>> | undefined,
  context: string,
): Array<Record<string, unknown>> {
  const next = Array.isArray(parts) ? [...parts] : [];
  if (!context.trim()) return next;
  if (next.some((part) => typeof part.text === 'string' && part.text.includes(context))) {
    return next;
  }
  next.push({ type: 'text', text: context });
  return next;
}

export function injectRequiredMemoryIntoModelRequest(
  context: unknown,
  memoryText: string,
): { messages: unknown[] } | undefined {
  if (!memoryText.trim()) return undefined;
  const root = asRecord(context);
  const request = Object.keys(asRecord(root.request)).length > 0 ? asRecord(root.request) : root;
  const rawMessages = Array.isArray(request.messages) ? request.messages : [];
  const serialized = JSON.stringify(rawMessages);
  if (serialized.includes(memoryText) || /REQUIRED MEMORIES -/.test(serialized)) {
    return undefined;
  }
  return {
    messages: [
      ...rawMessages,
      {
        role: 'user',
        content: [{ type: 'text', text: memoryText }],
      },
    ],
  };
}

export async function invokeMemoryWorkflow(
  name: string,
  params: Record<string, unknown> = {},
  options: RequiredMemoryOptions = {},
): Promise<unknown> {
  const descriptor = loadMemoryDescriptor(options);
  const method = resolveMemoryWorkflowMethod(name, descriptor);
  if (process.env.MCP_PLUGIN_REPL_LOG) {
    appendReplLog(method, params);
    if (process.env.MCP_MEMORY_REPL_RESPONSE) return process.env.MCP_MEMORY_REPL_RESPONSE;
    if (process.env.MCP_PLUGIN_REPL_RESPONSE) return process.env.MCP_PLUGIN_REPL_RESPONSE;
    return '';
  }
  if (!options.bridge) {
    throw new Error(`No REPL bridge available for ${method}`);
  }
  return options.bridge.invoke(method, params);
}
