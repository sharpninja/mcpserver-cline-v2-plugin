import type { ToolDescriptor as Tool } from '../tool-descriptor.js';
import type { ReplBridge, ReplResponse } from '../transport/repl-bridge.js';
import { cacheDelete, cacheWrite } from '../cache/cache-manager.js';

export const todoTools: Tool[] = [
  {
    name: 'todo_query',
    description:
      'Query project TODOs with optional filters for keyword, priority, section, and completion status.',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Filter by keyword in title or description' },
        priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'], description: 'Filter by priority' },
        section: { type: 'string', description: 'Filter by section/area' },
        done: { type: 'boolean', description: 'Filter by completion status' },
      },
    },
  },
  {
    name: 'todo_get',
    description: 'Fetch the full details of a single TODO by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'TODO ID (e.g. MCP-AUTH-001 or ISSUE-17)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'todo_select',
    description: 'Set a TODO as the active working context for the session.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'TODO ID to select as active context' },
      },
      required: ['id'],
    },
  },
  {
    name: 'todo_create',
    description: 'Create a new project TODO. Use ISSUE-NEW as id to create a GitHub-backed issue.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'TODO ID (pattern: [A-Z]+-[A-Z0-9]+-\\d{3} or ISSUE-NEW)' },
        title: { type: 'string', description: 'TODO title' },
        section: { type: 'string', description: 'Project section or area' },
        priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'], description: 'Priority level' },
        estimate: { type: 'string', description: 'Time estimate (e.g. 4h, 2d)' },
        description: { type: 'array', items: { type: 'string' }, description: 'Bullet-point description' },
        implementationTasks: {
          type: 'array',
          items: { type: 'object', properties: { task: { type: 'string' }, done: { type: 'boolean' } }, required: ['task'] },
          description: 'Sub-tasks with completion status',
        },
        dependsOn: { type: 'array', items: { type: 'string' }, description: 'TODO IDs this depends on' },
        functionalRequirements: { type: 'array', items: { type: 'string' }, description: 'FR-* IDs' },
        technicalRequirements: { type: 'array', items: { type: 'string' }, description: 'TR-* IDs' },
        technicalDetails: { type: 'string', description: 'Architecture or design notes' },
      },
      required: ['id', 'title', 'section', 'priority'],
    },
  },
  {
    name: 'todo_update',
    description: 'Modify fields of an existing TODO. Set done:true with doneSummary to mark complete.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'TODO ID to update' },
        remaining: { type: 'string', description: 'Work still needed' },
        done: { type: 'boolean', description: 'Mark as completed' },
        doneSummary: { type: 'string', description: 'Summary of completed work (required when done:true)' },
        implementationTasks: {
          type: 'array',
          items: { type: 'object', properties: { task: { type: 'string' }, done: { type: 'boolean' } }, required: ['task'] },
        },
        technicalDetails: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'todo_update_selected',
    description: 'Patch the currently selected TODO without repeating the ID.',
    inputSchema: {
      type: 'object',
      properties: {
        remaining: { type: 'string' },
        done: { type: 'boolean' },
        doneSummary: { type: 'string' },
        implementationTasks: { type: 'array', items: { type: 'object', properties: { task: { type: 'string' }, done: { type: 'boolean' } }, required: ['task'] } },
      },
    },
  },
  {
    name: 'todo_delete',
    description: 'Remove a TODO permanently.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'TODO ID to delete' },
      },
      required: ['id'],
    },
  },
  {
    name: 'todo_stream_status',
    description: 'Request an AI-driven status analysis of a TODO, showing blockers and dependency state.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'TODO ID to analyze' },
      },
      required: ['id'],
    },
  },
  {
    name: 'todo_stream_plan',
    description: 'Generate a streaming implementation plan for a TODO.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'TODO ID to plan' },
      },
      required: ['id'],
    },
  },
  {
    name: 'todo_stream_implement',
    description: 'Execute an AI-driven implementation run for a TODO and stream progress.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'TODO ID to implement' },
      },
      required: ['id'],
    },
  },
  {
    name: 'todo_analyze_requirements',
    description: 'Detect missing FR/TR traceability for a TODO.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'TODO ID to analyze' },
      },
      required: ['id'],
    },
  },
];

const toolMethodMap: Record<string, string> = {
  todo_query: 'workflow.todo.query',
  todo_get: 'workflow.todo.get',
  todo_select: 'workflow.todo.select',
  todo_create: 'workflow.todo.create',
  todo_update: 'workflow.todo.update',
  todo_update_selected: 'workflow.todo.updateSelected',
  todo_delete: 'workflow.todo.delete',
  todo_stream_status: 'workflow.todo.streamStatus',
  todo_stream_plan: 'workflow.todo.streamPlan',
  todo_stream_implement: 'workflow.todo.streamImplement',
  todo_analyze_requirements: 'workflow.todo.analyzeRequirements',
};

const mutatingTodoTools = new Set(['todo_create', 'todo_update', 'todo_update_selected', 'todo_delete']);

export function canHandleTodoTool(name: string): boolean {
  return name in toolMethodMap;
}

function stringArg(args: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return '';
}

function unwrapRequest(args: Record<string, unknown>): Record<string, unknown> {
  const request = args.request;
  if (request && typeof request === 'object' && !Array.isArray(request)) {
    return request as Record<string, unknown>;
  }
  return args;
}

function normalizeSection(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  return value.trim().toLowerCase() === 'ui' ? 'UI' : 'Backlog';
}

function stringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const values = value
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim());
    return values.length > 0 ? values : undefined;
  }
  if (typeof value === 'string' && value.trim().length > 0) return [value.trim()];
  return undefined;
}

function implementationTasks(value: unknown): Array<{ task: string; done: boolean }> | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return [{ task: value.trim(), done: false }];
  }

  if (!Array.isArray(value)) return undefined;

  const tasks = value
    .map((item) => {
      if (typeof item === 'string') {
        return item.trim().length > 0 ? { task: item.trim(), done: false } : undefined;
      }

      if (!item || typeof item !== 'object') return undefined;
      const record = item as Record<string, unknown>;
      const task = stringArg(record, 'task', 'title', 'description', 'text');
      if (!task) return undefined;
      return { task, done: record.done === true };
    })
    .filter((item): item is { task: string; done: boolean } => item !== undefined);

  return tasks.length > 0 ? tasks : undefined;
}

function todoBody(args: Record<string, unknown>, includeId: boolean): Record<string, unknown> {
  const source = unwrapRequest(args);
  const body: Record<string, unknown> = {};

  for (const key of [
    'title',
    'priority',
    'estimate',
    'note',
    'completedDate',
    'doneSummary',
    'remaining',
    'reference',
    'phase',
  ]) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0) body[key] = value;
  }

  if (includeId) {
    const id = stringArg(source, 'id');
    if (id) body.id = id;
  }

  const section = normalizeSection(source.section);
  if (section) body.section = section;
  if (typeof source.done === 'boolean') body.done = source.done;

  for (const key of ['description', 'technicalDetails', 'dependsOn', 'functionalRequirements', 'technicalRequirements']) {
    const values = stringList(source[key]);
    if (values) body[key] = values;
  }

  const tasks = implementationTasks(source.implementationTasks);
  if (tasks) body.implementationTasks = tasks;

  return body;
}

async function parseHttpResponseBody(response: Response): Promise<{ bodyText: string; contentType: string; result: unknown }> {
  const contentType = response.headers.get('content-type')?.split(';')[0] || 'application/json';
  const bodyText = await response.text().catch(() => '');
  let result: unknown = bodyText;
  if (/json/i.test(contentType) && bodyText) {
    try {
      result = JSON.parse(bodyText);
    } catch {
      result = bodyText;
    }
  }

  return { bodyText, contentType, result };
}

async function todoHttpFallback(
  name: string,
  args: Record<string, unknown>,
): Promise<ReplResponse | null> {
  const fetchFn = globalThis.fetch;
  const apiKey = process.env.MCPSERVER_API_KEY;
  const workspacePath = process.env.MCPSERVER_WORKSPACE_PATH ?? process.env.MCP_WORKSPACE_PATH;
  const baseUrl = process.env.MCPSERVER_BASE_URL ?? process.env.MCP_SERVER_URL;
  if (typeof fetchFn !== 'function' || !apiKey || !workspacePath || !baseUrl) return null;

  const source = unwrapRequest(args);
  const id = stringArg(source, 'id');
  const root = baseUrl.replace(/\/$/, '');
  const headers: Record<string, string> = {
    'X-Api-Key': apiKey,
    'X-Workspace-Path': workspacePath,
  };
  let url: string;
  let init: RequestInit = { headers };

  switch (name) {
    case 'todo_query': {
      const queryUrl = new URL(`${root}/mcpserver/todo`);
      const keyword = stringArg(source, 'keyword') || stringArg(source, 'title');
      const priority = stringArg(source, 'priority');
      const section = stringArg(source, 'section');
      const queryId = stringArg(source, 'id');
      const status = stringArg(source, 'status').toLowerCase();
      let done = typeof source.done === 'boolean' ? String(source.done) : '';
      if (!done && status) {
        if (['open', 'active', 'pending', 'in_progress', 'in-progress'].includes(status)) done = 'false';
        else if (['closed', 'complete', 'completed', 'done'].includes(status)) done = 'true';
      }

      if (keyword) queryUrl.searchParams.set('keyword', keyword);
      if (priority) queryUrl.searchParams.set('priority', priority);
      if (section) queryUrl.searchParams.set('section', section);
      if (queryId) queryUrl.searchParams.set('id', queryId);
      if (done) queryUrl.searchParams.set('done', done);
      url = queryUrl.toString();
      break;
    }

    case 'todo_get':
      if (!id) return null;
      url = `${root}/mcpserver/todo/${encodeURIComponent(id)}`;
      break;

    case 'todo_create':
      url = `${root}/mcpserver/todo`;
      init = {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(todoBody(source, true)),
      };
      break;

    case 'todo_update':
      if (!id) return null;
      url = `${root}/mcpserver/todo/${encodeURIComponent(id)}`;
      init = {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(todoBody(source, false)),
      };
      break;

    case 'todo_delete':
      if (!id) return null;
      url = `${root}/mcpserver/todo/${encodeURIComponent(id)}`;
      init = { method: 'DELETE', headers };
      break;

    case 'todo_analyze_requirements':
      if (!id) return null;
      url = `${root}/mcpserver/todo/${encodeURIComponent(id)}/requirements`;
      init = {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(todoBody(source, false)),
      };
      break;

    default:
      return null;
  }

  const response = await fetchFn(url, init);
  const parsed = await parseHttpResponseBody(response);
  if (!response.ok) {
    return {
      type: 'error',
      payload: {
        code: 'http_error',
        message: `TODO HTTP fallback returned HTTP ${response.status} for ${name}${parsed.bodyText ? `: ${parsed.bodyText}` : ''}`,
      },
    };
  }

  return {
    type: 'result',
    payload: {
      result: parsed.result,
      contentType: parsed.contentType,
    },
  };
}

export async function handleTodoTool(
  name: string,
  args: Record<string, unknown>,
  bridge: ReplBridge,
) {
  const method = toolMethodMap[name];
  if (!method) throw new Error(`Unknown todo tool: ${name}`);

  const failsafePath = mutatingTodoTools.has(name) ? await cacheWrite(method, args) : undefined;
  let response: ReplResponse;
  try {
    response = (await todoHttpFallback(name, args)) ?? (await bridge.invoke(method, args));
  } catch (error) {
    const suffix = failsafePath ? ` Local failsafe saved: ${failsafePath}` : '';
    throw new Error(`${error instanceof Error ? error.message : String(error)}${suffix}`);
  }

  if (response.type === 'error') {
    const payload = response.payload as { message?: string; code?: string };
    const suffix = failsafePath ? ` Local failsafe saved: ${failsafePath}` : '';
    throw new Error(`${payload.code ?? 'error'}: ${payload.message ?? 'Unknown error'}${suffix}`);
  }

  if (failsafePath) await cacheDelete(failsafePath);

  return response.payload;
}
