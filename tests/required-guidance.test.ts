// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadBundledGuidance, getEffectiveRequirementContext } from '../src/required-guidance.js';

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'qb-guidance-'));
  roots.push(root);
  mkdirSync(join(root, 'guidance'));
  mkdirSync(join(root, 'skills', 'example'), { recursive: true });
  const manifest = {
    qbrainGovernance: {
      version: 1,
      guidance: ['guidance/required.md'],
      skills: [{ id: 'example', path: 'skills/example/SKILL.md' }],
    },
  };
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
  writeFileSync(join(root, 'guidance/required.md'), 'Required host guidance.');
  writeFileSync(
    join(root, 'skills/example/SKILL.md'),
    '---\nname: Example\ndescription: Only when requested.\n---\nRun only on its trigger.',
  );
  return { root, manifest, save: () => writeFileSync(join(root, 'package.json'), JSON.stringify(manifest)) };
}
afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});
const empty = () => ({
  currentLayer: { key: 'layer-1', name: 'Workspace' },
  functional: [],
  technical: [],
  testing: [],
  mappings: [],
});
function bridge(value: unknown = empty()) {
  return { invoke: jest.fn().mockResolvedValue({ type: 'result', payload: { result: value } }) };
}

test('captures all declared assets and exposes immutable skill contents without running them', () => {
  const { root } = fixture();
  const bundle = loadBundledGuidance(root);
  expect(bundle.text).toContain('Required host guidance.');
  expect(bundle.text).toContain('Only when requested.');
  expect(bundle.text).not.toContain('Run only on its trigger.');
  expect(bundle.skills.map((s) => s.id)).toEqual(['example']);
  expect(bundle.readSkill('example')).toContain('Run only on its trigger.');
  writeFileSync(join(root, 'skills/example/SKILL.md'), 'changed');
  expect(bundle.readSkill('example')).not.toBe('changed');
  expect(Object.isFrozen(bundle)).toBe(true);
  expect(Object.isFrozen(bundle.skills)).toBe(true);
  expect(() => bundle.readSkill('../package.json')).toThrow();
});
test('real inventory contains every packaged skill and no marker/bootstrap prompt', () => {
  const bundle = loadBundledGuidance(process.cwd());
  expect(bundle.skills).toHaveLength(10);
  for (const item of bundle.skills)
    expect(bundle.readSkill(item.id)).toBe(readFileSync(join(process.cwd(), item.path), 'utf8'));
  expect(bundle.text).not.toContain('user-prompt-submit.sh');
  expect(bundle.text).not.toContain('AGENTS-README-FIRST.yaml');
});
test.each([
  'missing-manifest',
  'missing-guidance',
  'missing-skill',
  'symlink',
  'extra-skill',
  'bad-frontmatter',
  'duplicate',
  'traversal',
  'unsupported-version',
  'oversized',
])('refuses incomplete or unsafe bundle: %s', (kind) => {
  const f = fixture();
  if (kind === 'missing-manifest') rmSync(join(f.root, 'package.json'));
  if (kind === 'missing-guidance') rmSync(join(f.root, 'guidance/required.md'));
  if (kind === 'missing-skill') rmSync(join(f.root, 'skills/example/SKILL.md'));
  if (kind === 'symlink') {
    rmSync(join(f.root, 'guidance/required.md'));
    symlinkSync(join(f.root, 'package.json'), join(f.root, 'guidance/required.md'));
  }
  if (kind === 'extra-skill') {
    mkdirSync(join(f.root, 'skills/extra'));
    writeFileSync(join(f.root, 'skills/extra/SKILL.md'), 'extra');
  }
  if (kind === 'bad-frontmatter') writeFileSync(join(f.root, 'skills/example/SKILL.md'), 'no metadata');
  if (kind === 'duplicate') {
    f.manifest.qbrainGovernance.skills.push(f.manifest.qbrainGovernance.skills[0]);
    f.save();
  }
  if (kind === 'traversal') {
    f.manifest.qbrainGovernance.guidance = ['../outside.md'];
    f.save();
  }
  if (kind === 'unsupported-version') {
    f.manifest.qbrainGovernance.version = 2;
    f.save();
  }
  if (kind === 'oversized') writeFileSync(join(f.root, 'guidance/required.md'), 'x'.repeat(1024 * 1024 + 1));
  expect(() => loadBundledGuidance(f.root)).toThrow();
});
test('effective requirements preserve bodies, ACs, mappings and extra fields without summarizing', async () => {
  const requirement = {
    id: 'FR-X-001',
    title: 'Title',
    body: 'first\nsecond',
    acceptanceCriteria: [{ text: 'Exact AC' }],
    notes: 'verbatim',
  };
  const value = {
    ...empty(),
    functional: [requirement],
    technical: [{ id: 'TR-X-001', title: 'Technical', body: 'Exact technical body' }],
    testing: [{ id: 'TEST-X-001', title: 'Test', condition: 'Exact condition' }],
    mappings: [{ frId: 'FR-X-001', trIds: ['TR-X-001'], testIds: ['TEST-X-001'] }],
  };
  const transport = bridge(value);
  const text = await getEffectiveRequirementContext(transport);
  expect(transport.invoke).toHaveBeenCalledWith('workflow.requirements.effective', {});
  expect(JSON.parse(text.slice(text.indexOf('\n') + 1))).toEqual(value);
});
test('accepts an explicit successful empty effective set', async () => {
  expect(await getEffectiveRequirementContext(bridge())).toContain('"functional": []');
});
test.each([
  undefined,
  {},
  { ...empty(), currentLayer: {} },
  { ...empty(), testing: null },
  { ...empty(), functional: [{}] },
  { ...empty(), error: 'failed' },
  { ...empty(), success: false },
])('rejects malformed effective result %#', async (value) => {
  const transport = bridge();
  transport.invoke.mockResolvedValue({ type: 'result', payload: { result: value } });
  await expect(getEffectiveRequirementContext(transport)).rejects.toThrow('Effective requirements');
});
test('transport failure is never an empty effective set', async () => {
  const transport = bridge();
  transport.invoke.mockRejectedValue(new Error('offline'));
  await expect(getEffectiveRequirementContext(transport)).rejects.toThrow('Effective requirements');
});
