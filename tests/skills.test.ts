import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '..');
const skillPath = path.join(root, 'skills', 'workspace', 'SKILL.md');
const workflowSkills = ['sync-logs', 'commit-sync', 'wrap-up'] as const;

function readSkill(skillName: string): string {
  return fs.readFileSync(path.join(root, 'skills', skillName, 'SKILL.md'), 'utf8');
}

function frontmatter(content: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}

describe('workspace initialization skill', () => {
  test('is packaged with the Cline plugin', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      files?: string[];
    };

    expect(packageJson.files).toContain('skills/');
    expect(fs.existsSync(skillPath)).toBe(true);
  });

  test('documents the workspace lifecycle methods', () => {
    const content = fs.readFileSync(skillPath, 'utf8');

    expect(content).toContain('client.Workspace.ListAsync');
    expect(content).toContain('client.Workspace.CreateAsync');
    expect(content).toContain('client.Workspace.InitAsync');
    expect(content).toContain('type: request');
  });

  test('packages workflow skills for AC-SKILLS-001, AC-SKILLS-002, and AC-SKILLS-006', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      files?: string[];
    };

    expect(packageJson.files).toContain('skills/');

    for (const skillName of workflowSkills) {
      const content = readSkill(skillName);

      expect(content.trim().length).toBeGreaterThan(0);
      expect(frontmatter(content)).toMatch(/^name:\s*.+$/m);
      expect(frontmatter(content)).toMatch(/^description:\s*.+$/m);
    }
  });

  test('documents sync-logs behavior for AC-SKILLS-003', () => {
    const content = readSkill('sync-logs');

    expect(content).toMatch(/status check|mcp.*status|Status/i);
    expect(content).toMatch(/workflow\.sessionlog\.(openSession|beginTurn)|session\/turn|turn handling/);
    expect(content).toContain('workflow.sessionlog.appendDialog');
    expect(content).toContain('workflow.sessionlog.appendActions');
    expect(content).toMatch(/background.*session|session.*background/i);
    expect(content).toMatch(/factual summary|factual.*summary/i);
    expect(content).toMatch(/raw[\s-]*REST/i);
  });

  test('documents commit-sync behavior for AC-SKILLS-004', () => {
    const content = readSkill('commit-sync');

    expect(content).toMatch(/pause/i);
    expect(content).toMatch(/repo-scope|repo scope|dirty tree|dirty-tree/i);
    expect(content).toMatch(/acknowledg/i);
    expect(content).toContain('git add -A -- .');
    expect(content).toMatch(/commit SHA|git rev-parse HEAD/i);
    expect(content).toMatch(/push result|git push/i);
    expect(content).toMatch(/force|rewrite/i);
  });

  test('documents wrap-up behavior for AC-SKILLS-005', () => {
    const content = readSkill('wrap-up');

    expect(content).toMatch(/marker trust|trust.*marker/i);
    expect(content).toMatch(/requirement reconciliation|requirements.*reconcile|reconcile.*requirements/i);
    expect(content).toMatch(/wiki|generateDocument/i);
    expect(content).toMatch(/validation/i);
    expect(content).toMatch(/commit/i);
    expect(content).toMatch(/push/i);
    expect(content).toMatch(/session-log reconciliation|session log reconciliation|reconcile.*session/i);
    expect(content).toMatch(/workflow\.sessionlog\.(completeTurn|failTurn)/);
  });
});
