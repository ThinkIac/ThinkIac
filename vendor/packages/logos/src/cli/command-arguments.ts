type Parameter = {
  name: string;
  type: string;
  description: string;
  required: boolean;
  aliases?: string[];
  enum?: string[];
};

type Command = {
  name: string;
  description?: string;
  parameters: Parameter[];
  order?: string[];
};

function aliasFlag(alias: string): string {
  return alias.length === 1 ? `-${alias}` : `--${alias}`;
}

export function commandHelpRequested(argv: string[]): boolean {
  const end = argv.indexOf('--');
  return (end === -1 ? argv : argv.slice(0, end)).some(arg => arg === '--help' || arg === '-h');
}

export function usesDeclaredArguments(command: Command): boolean {
  return Boolean(command.order?.length || command.parameters.some(parameter => parameter.aliases?.length));
}

function normalizeValue(parameter: Parameter, value: unknown, fromCli: boolean): unknown {
  const { name, type } = parameter;
  const invalid = () => new Error(`Invalid value for --${name}: expected ${type}`);
  if (type === 'boolean') {
    if (fromCli && (value === 'true' || value === 'false')) return value === 'true';
    if (typeof value !== 'boolean') throw invalid();
  }
  if (type === 'number' || type === 'integer') {
    if (fromCli && typeof value === 'string' && /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) value = Number(value);
    if (typeof value !== 'number' || !Number.isFinite(value) || (type === 'integer' && !Number.isInteger(value))) {
      throw invalid();
    }
  }
  if (type === 'string' && typeof value !== 'string') throw invalid();
  if (type === 'object' || type === 'array' || type.endsWith('[]')) {
    if (fromCli && typeof value === 'string') {
      try { value = JSON.parse(value); } catch { throw invalid(); }
    }
    if (type === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
    } else {
      if (!Array.isArray(value)) throw invalid();
      if (type.endsWith('[]')) {
        const element = { ...parameter, type: type.slice(0, -2), enum: undefined };
        value.forEach(item => normalizeValue(element, item, false));
      }
    }
  }
  if (parameter.enum && !parameter.enum.includes(String(value))) {
    throw new Error(`Invalid value for --${name}: expected one of ${parameter.enum.join(', ')}`);
  }
  return value;
}

export function parseCommandArguments(argv: string[], command: Command): Record<string, unknown> {
  const byName = new Map(command.parameters.map(parameter => [parameter.name, parameter]));
  const flags = new Map<string, Parameter>();
  for (const parameter of command.parameters) {
    flags.set(`--${parameter.name}`, parameter);
    for (const alias of parameter.aliases || []) flags.set(aliasFlag(alias), parameter);
  }

  const values = new Map<string, unknown>();
  const assign = (parameter: Parameter, value: unknown, fromCli: boolean) => {
    if (values.has(parameter.name)) throw new Error(`Duplicate parameter: --${parameter.name}`);
    values.set(parameter.name, normalizeValue(parameter, value, fromCli));
  };

  let literal = false;
  let usedJson = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!literal && arg === '--') {
      literal = true;
      continue;
    }
    if (literal || !arg.startsWith('-') || arg === '-') {
      const name = command.order?.find(name => !values.has(name));
      if (!name) throw new Error(`Unexpected positional argument: ${arg}`);
      assign(byName.get(name)!, arg, true);
      continue;
    }

    const equals = arg.indexOf('=');
    const flag = equals === -1 ? arg : arg.slice(0, equals);
    let value = equals === -1 ? undefined : arg.slice(equals + 1);
    const parameter = flags.get(flag);
    if (!parameter && flag !== '--params') throw new Error(`Unknown option: ${flag}`);
    if (value === undefined) {
      const next = argv[i + 1];
      if (parameter?.type === 'boolean') {
        if (next === 'true' || next === 'false') value = argv[++i];
      } else {
        const signedNumber = parameter && ['number', 'integer'].includes(parameter.type) && /^-(?:\d|\.\d)/.test(next ?? '');
        if (next === undefined || (next.startsWith('-') && next !== '-' && !signedNumber)) {
          throw new Error(`Missing value for ${flag}`);
        }
        value = argv[++i];
      }
    }

    if (flag === '--params') {
      if (usedJson) throw new Error('Duplicate option: --params');
      usedJson = true;
      let json: unknown;
      try { json = JSON.parse(value!); } catch { throw new Error('--params must be a valid JSON object'); }
      if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('--params must be a valid JSON object');
      for (const [name, entry] of Object.entries(json)) {
        const declared = byName.get(name);
        if (!declared) throw new Error(`Unknown parameter: ${name}`);
        assign(declared, entry, false);
      }
      continue;
    }

    assign(parameter!, value ?? true, true);
  }

  for (const parameter of command.parameters) {
    if (parameter.required && !values.has(parameter.name)) throw new Error(`Missing required parameter: --${parameter.name}`);
  }
  return Object.fromEntries(values);
}

export function formatCommandHelp(bin: string, folder: string, command: Command): string {
  const ordered = (command.order || []).map(name => command.parameters.find(parameter => parameter.name === name)!);
  const positionals = ordered.map(({ name, required }) => required ? `<${name}>` : `[${name}]`);
  const prefix = `${bin} ${folder} ${command.name}`;
  const lines = ['Usage:', `  ${[prefix, ...positionals, '[options]'].join(' ')}`];
  if (command.description) lines.push('', command.description);
  if (ordered.length) {
    lines.push('', 'Arguments:', ...ordered.map(({ name, description }) => `  ${name}\t${description}`));
  }
  lines.push('', 'Options:');
  for (const { name, type, required, description, aliases = [] } of command.parameters) {
    const flags = [...aliases.map(aliasFlag), `--${name}`].join(', ');
    const label = type === 'boolean' ? flags : `${flags} <${type}>`;
    lines.push(`  ${label}\t${description}${required ? ' (required)' : ''}`);
  }
  lines.push('  --params <json>\tSupply named parameters as a JSON object', '  -h, --help\tShow command help');
  const required = command.parameters.filter(parameter => parameter.required);
  const flagExample = (parameter: Parameter) => `--${parameter.name}${parameter.type === 'boolean' ? '' : ` <${parameter.name}>`}`;
  if (positionals.length) {
    const remaining = required.filter(parameter => !ordered.includes(parameter));
    lines.push('', 'Examples:', `  ${[prefix, ...positionals, ...remaining.map(flagExample)].join(' ')}`);
  }
  lines.push('', 'Legacy:', `  ${[`${bin} ${folder}:${command.name}`, ...required.map(flagExample)].join(' ')}`);
  return lines.join('\n');
}
