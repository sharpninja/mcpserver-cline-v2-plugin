import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '..');
const skillPath = path.join(root, 'skills', 'workspace', 'SKILL.md');

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
});
