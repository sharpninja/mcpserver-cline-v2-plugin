import * as fs from 'fs';
import * as path from 'path';

const root = process.cwd();
const skillPath = path.join(root, 'skills', 'memory', 'SKILL.md');
const descriptorPath = path.join(root, 'memory-descriptor.json');

describe('cline-v2 memory skill and descriptor', () => {
  test('skill loads with required verbs and injection/fallback notes', () => {
    const content = fs.readFileSync(skillPath, 'utf8');
    expect(content.trim().length).toBeGreaterThan(0);
    expect(content).toMatch(/^---/m);
    expect(content).toContain('memory_remember');
    expect(content).toContain('memory_recall');
    expect(content).toContain('memory_explore');
    expect(content).toContain('memory_consolidate');
    expect(content).toContain('memory_promote');
    expect(content).toContain('workflow.memory.remember');
    expect(content).toContain('workflow.memory.list');
    expect(content).toContain('lib/repl-invoke.ps1');
    expect(content).toContain('skills/memory/scripts/invoke.ps1');
    expect(content).toContain('beforeRun');
    expect(content).toContain('beforeModel');
    expect(content).toMatch(/injection/i);
    expect(content).toMatch(/fallback/i);
  });

  test('descriptor loads without live cloud keys', () => {
    const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8')) as {
      host: string;
      tools: string[];
      injection: { requiredMemoriesPrefix: string };
      fallback: { localFailsafe: boolean };
      workflowMethods: Record<string, string>;
    };
    expect(descriptor.host).toBe('cline-v2');
    expect(descriptor.tools).toEqual(expect.arrayContaining([
      'memory_remember',
      'memory_recall',
      'memory_explore',
      'memory_consolidate',
      'memory_promote',
    ]));
    expect(descriptor.injection.requiredMemoriesPrefix).toContain('REQUIRED MEMORIES');
    expect(descriptor.fallback.localFailsafe).toBe(true);
    expect(descriptor.workflowMethods.memory_remember).toBe('workflow.memory.remember');
    expect(descriptor.workflowMethods.memory_list).toBe('workflow.memory.list');
    expect(JSON.stringify(descriptor)).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
  });

  test('exposes executable wrapper scripts for workflow.memory.*', () => {
    const invokePath = path.join(root, 'skills', 'memory', 'scripts', 'invoke.ps1');
    const invoke = fs.readFileSync(invokePath, 'utf8');
    expect(invoke).toContain('memory-descriptor.json');
    expect(invoke).toContain('Resolve-McpMemoryWorkflowMethod');
    expect(invoke).toContain('lib/repl-invoke.ps1');
    expect(invoke).toContain('workflow.memory.');
  });
});
