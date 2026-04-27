import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES_DIR = join(ROOT, 'sources');
const DIST_DIR = join(ROOT, 'dist');
const CONFIG_PATH = join(ROOT, 'build.config.yaml');

interface OutputSpec {
  name: string;
  sources: string[];
}

interface BuildConfig {
  outputs: OutputSpec[];
}

interface RuleGroup {
  comment: string | null;
  rules: string[];
}

function loadGroups(relativePath: string): RuleGroup[] {
  const fullPath = join(SOURCES_DIR, relativePath);
  const content = readFileSync(fullPath, 'utf8');

  const groups: RuleGroup[] = [];
  let current: RuleGroup = { comment: null, rules: [] };

  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line.length === 0) continue;

    if (line.startsWith('#')) {
      if (current.rules.length > 0 || current.comment !== null) {
        groups.push(current);
      }
      current = { comment: line.replace(/^#\s*/, ''), rules: [] };
    } else {
      current.rules.push(line);
    }
  }
  if (current.rules.length > 0 || current.comment !== null) {
    groups.push(current);
  }

  return groups;
}

function buildOutput(spec: OutputSpec): string {
  const seen = new Set<string>();
  const blocks: RuleGroup[] = [];

  for (const sourcePath of spec.sources) {
    for (const group of loadGroups(sourcePath)) {
      const fresh = group.rules.filter(r => {
        if (seen.has(r)) return false;
        seen.add(r);
        return true;
      });
      if (fresh.length === 0) continue;
      blocks.push({ comment: group.comment, rules: fresh });
    }
  }

  const header = [
    `# Generated from: ${spec.sources.join(', ')}`,
    `# Do not edit by hand — edit sources/ and re-run scripts/build.ts`,
  ].join('\n');

  const body = blocks
    .map(block => {
      const lines: string[] = [];
      if (block.comment) lines.push(`  # ${block.comment}`);
      for (const rule of block.rules) lines.push(`  - ${rule}`);
      return lines.join('\n');
    })
    .join('\n\n');

  return `${header}\n\npayload:\n${body}\n`;
}

function main() {
  const configRaw = readFileSync(CONFIG_PATH, 'utf8');
  const config = yaml.load(configRaw) as BuildConfig;

  if (existsSync(DIST_DIR)) {
    for (const entry of readdirSync(DIST_DIR)) {
      rmSync(join(DIST_DIR, entry), { recursive: true, force: true });
    }
  } else {
    mkdirSync(DIST_DIR, { recursive: true });
  }

  for (const spec of config.outputs) {
    const content = buildOutput(spec);
    const outPath = join(DIST_DIR, `${spec.name}.yaml`);
    writeFileSync(outPath, content);
    const ruleCount = content
      .split('\n')
      .filter(l => l.startsWith('  - ')).length;
    console.log(`✓ ${spec.name}.yaml (${ruleCount} rules)`);
  }
}

main();
