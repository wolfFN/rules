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

type SourceSpec = string | { url: string; comment?: string };

interface OutputSpec {
  name: string;
  sources: SourceSpec[];
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

async function loadGroupsFromUrl(
  url: string,
  comment?: string,
): Promise<RuleGroup[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    throw new Error(`Fetch ${url} failed: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  const parsed = yaml.load(text) as { payload?: unknown };
  const payload = parsed?.payload;
  if (!Array.isArray(payload)) {
    throw new Error(`${url}: missing or non-array \`payload\``);
  }
  const rules = payload.map(item => String(item).trim()).filter(Boolean);
  return [{ comment: comment ?? url, rules }];
}

function describeSource(s: SourceSpec): string {
  return typeof s === 'string' ? s : s.url;
}

async function buildOutput(spec: OutputSpec): Promise<string> {
  const seen = new Set<string>();
  const blocks: RuleGroup[] = [];

  for (const source of spec.sources) {
    const groups =
      typeof source === 'string'
        ? loadGroups(source)
        : await loadGroupsFromUrl(source.url, source.comment);

    for (const group of groups) {
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
    `# Generated from: ${spec.sources.map(describeSource).join(', ')}`,
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

async function main() {
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
    const content = await buildOutput(spec);
    const outPath = join(DIST_DIR, `${spec.name}.yaml`);
    writeFileSync(outPath, content);
    const ruleCount = content
      .split('\n')
      .filter(l => l.startsWith('  - ')).length;
    console.log(`✓ ${spec.name}.yaml (${ruleCount} rules)`);
  }
}

main();
