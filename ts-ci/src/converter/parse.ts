import { parse as parseYaml } from 'yaml';

export interface ParsedWorkflow {
  name?: string;
  on: ParsedTriggers;
  permissions?: unknown;
  concurrency?: unknown;
  defaults?: unknown;
  env?: Record<string, string>;
  jobs: Record<string, ParsedJob>;
}

export type ParsedTriggers =
  | string
  | string[]
  | Record<string, ParsedTriggerConfig | null>;

export type ParsedTriggerConfig = Record<string, unknown> | Array<Record<string, unknown>>;

export interface ParsedJob {
  name?: string;
  'runs-on': string | string[];
  needs?: string | string[];
  if?: string;
  steps: ParsedStep[];
  strategy?: { matrix?: Record<string, unknown>; 'fail-fast'?: boolean; 'max-parallel'?: number };
  'timeout-minutes'?: number;
  permissions?: unknown;
  outputs?: Record<string, string>;
  env?: Record<string, string>;
  services?: Record<string, unknown>;
  defaults?: unknown;
  environment?: string | { name: string; url?: string };
  concurrency?: unknown;
  'continue-on-error'?: boolean;
}

export interface ParsedStep {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  shell?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  if?: string;
  'working-directory'?: string;
  'continue-on-error'?: boolean;
  'timeout-minutes'?: number;
}

export function parseWorkflow(yamlSource: string): ParsedWorkflow {
  const data = parseYaml(yamlSource);
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid workflow: expected a YAML mapping at the document root');
  }
  if (!('jobs' in data) || typeof (data as Record<string, unknown>).jobs !== 'object') {
    throw new Error('Invalid workflow: missing `jobs:` mapping');
  }
  if (!('on' in data)) {
    throw new Error('Invalid workflow: missing `on:` field');
  }
  return data as ParsedWorkflow;
}
