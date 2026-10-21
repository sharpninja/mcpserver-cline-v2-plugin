// SPDX-License-Identifier: Apache-2.0
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import type { MemoryFetchBridge } from './memory-context.js';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  return value as Record<string, unknown>;
}
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim();
}

export interface BundledSkill {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly description: string;
}
export interface BundledGuidance {
  readonly text: string;
  readonly skills: readonly BundledSkill[];
  readSkill(id: string): string;
}

/** Read only a host-verified installation. Archive/tree authentication remains the host's prerequisite. */
export function loadBundledGuidance(pluginRoot: string): BundledGuidance {
  try {
    if (
      !isAbsolute(pluginRoot) ||
      !lstatSync(pluginRoot).isDirectory() ||
      lstatSync(pluginRoot).isSymbolicLink()
    )
      throw new Error();
    let bytes = 0;
    function read(relative: string): string {
      if (
        !/^[a-zA-Z0-9._/-]+$/.test(relative) ||
        relative.split('/').some((p) => !p || p === '.' || p === '..')
      )
        throw new Error();
      let path = pluginRoot;
      const parts = relative.split('/');
      for (const [index, part] of parts.entries()) {
        path = join(path, part);
        const stat = lstatSync(path);
        if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile()))
          throw new Error();
      }
      const data = readFileSync(path);
      bytes += data.length;
      if (data.length > 1024 * 1024 || bytes > 8 * 1024 * 1024) throw new Error('Guidance is too large.');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
      if (!text.trim()) throw new Error('Empty asset.');
      return text;
    }
    const manifest = object(object(JSON.parse(read('package.json'))).qbrainGovernance);
    if (
      manifest.version !== 1 ||
      !Array.isArray(manifest.guidance) ||
      !manifest.guidance.length ||
      !Array.isArray(manifest.skills) ||
      !manifest.skills.length
    )
      throw new Error('Missing guidance inventory.');
    const guidancePaths = new Set<string>();
    const guidance = manifest.guidance.map((value) => {
      if (typeof value !== 'string' || !/^guidance\/[a-z0-9-]+\.md$/.test(value) || guidancePaths.has(value))
        throw new Error('Invalid guidance path.');
      guidancePaths.add(value);
      return read(value);
    });
    const captured = new Map<string, string>();
    const declared = new Set<string>();
    const skills: readonly BundledSkill[] = Object.freeze(
      manifest.skills.map((value) => {
        const item = object(value);
        if (
          typeof item.id !== 'string' ||
          !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id) ||
          item.path !== `skills/${item.id}/SKILL.md` ||
          captured.has(item.id)
        )
          throw new Error('Invalid skill declaration.');
        const path = item.path as string;
        const content = read(path);
        const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
        if (!match) throw new Error('Missing skill metadata.');
        const metadata = object(loadYaml(match[1]));
        if (!nonempty(metadata.name) || !nonempty(metadata.description))
          throw new Error('Invalid skill metadata.');
        captured.set(item.id, content);
        declared.add(path);
        return Object.freeze({ id: item.id, path, name: metadata.name, description: metadata.description });
      }),
    );
    const actual = new Set<string>();
    function inventory(relative: string, depth: number): void {
      if (depth > 8) throw new Error('Skill nesting too deep.');
      for (const entry of readdirSync(join(pluginRoot, relative), { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error('Linked skill asset.');
        const path = `${relative}/${entry.name}`;
        if (entry.isDirectory()) inventory(path, depth + 1);
        else if (!entry.isFile()) throw new Error('Non-file skill asset.');
        else if (entry.name.toLowerCase() === 'skill.md') actual.add(path);
      }
    }
    inventory('skills', 0);
    if (actual.size !== declared.size || [...actual].some((path) => !declared.has(path)))
      throw new Error('Skill inventory mismatch.');
    const catalogue = skills.map((skill) => `${skill.id}: ${skill.name} — ${skill.description}`).join('\n');
    return Object.freeze({
      text: `${guidance.join('\n\n')}\n\nRequired skill inventory (read applicable skill with qbrain_skill_read; do not execute unrelated workflows):\n${catalogue}`,
      skills,
      readSkill(id: string): string {
        const content = captured.get(id);
        if (content === undefined)
          throw new Error('Unknown required skill. Select an exact ID from the required inventory.');
        return content;
      },
    });
  } catch (cause) {
    throw new Error('Required bundled guidance is unavailable or invalid; governed execution is blocked.', {
      cause,
    });
  }
}

/** Supported plugin workflow preserves the complete effective DTO, including ACs, scope and mappings. */
export async function getEffectiveRequirementContext(bridge: MemoryFetchBridge): Promise<string> {
  try {
    let result = object(await bridge.invoke('workflow.requirements.effective', {}));
    if (result.type !== 'result' || result.error) throw new Error();
    result = object(result.payload);
    for (let depth = 0; depth < 3; depth++) {
      if (result.error || result.success === false || result.ok === false) throw new Error();
      if (result.result === undefined) break;
      result = object(result.result);
    }
    if (result.error || result.success === false || result.ok === false) throw new Error();
    const layer = object(result.currentLayer);
    if (!nonempty(layer.key) || !nonempty(layer.name)) throw new Error();
    for (const group of ['functional', 'technical', 'testing']) {
      const rows = result[group];
      const ids = new Set<string>();
      if (!Array.isArray(rows)) throw new Error();
      for (const value of rows) {
        const item = object(value);
        if (
          !nonempty(item.id) ||
          !nonempty(item.title) ||
          typeof item[group === 'testing' ? 'condition' : 'body'] !== 'string' ||
          ids.has(item.id)
        )
          throw new Error();
        ids.add(item.id);
      }
    }
    if (!Array.isArray(result.mappings)) throw new Error();
    for (const value of result.mappings) {
      const mapping = object(value);
      if (
        !nonempty(mapping.frId) ||
        !Array.isArray(mapping.trIds) ||
        !mapping.trIds.every(nonempty) ||
        !Array.isArray(mapping.testIds) ||
        !mapping.testIds.every(nonempty)
      )
        throw new Error();
    }
    return `EFFECTIVE REQUIREMENTS\n${JSON.stringify(result, null, 2)}`;
  } catch (cause) {
    throw new Error('Effective requirements are unavailable or invalid; governed execution is blocked.', {
      cause,
    });
  }
}
