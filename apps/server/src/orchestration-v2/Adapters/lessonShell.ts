const SHELL_WRAPPERS = new Set(
  "bash sh eval command env exec nice nohup setsid sudo timeout time".split(" "),
);
const SEPARATORS = new Set([";", "&&", "||", "|", "(", ")"]);
export function commandIndex(parts: ReadonlyArray<string>): number | undefined {
  for (let i = 0; i < parts.length; i += 1) {
    const value = parts[i]!.replace(/^['"]|['"]$/gu, "");
    if (!value || value.startsWith("-") || /^\w+=/u.test(value)) continue;
    if (
      value === "command" &&
      ["-v", "-V", "--verbose"].includes((parts[i + 1] ?? "").replace(/^['"]|['"]$/gu, ""))
    )
      return undefined;
    if (value === "timeout") {
      if (i + 1 < parts.length && !(parts[i + 1] ?? "").startsWith("-")) i += 1;
      continue;
    }
    if (value === "nice") {
      if (["-n", "--adjustment"].includes(parts[i + 1] ?? "")) i += 2;
      continue;
    }
    if (value === "env") {
      while (
        i + 1 < parts.length &&
        (/^\w+=/u.test(parts[i + 1]!) || parts[i + 1]!.startsWith("-"))
      )
        i += 1;
      continue;
    }
    if (value === "sudo") {
      while (i + 1 < parts.length && parts[i + 1]!.startsWith("-")) i += 1;
      continue;
    }
    if (SHELL_WRAPPERS.has(value)) continue;
    return i;
  }
  return undefined;
}
export function commandName(parts: ReadonlyArray<string>): string | undefined {
  const i = commandIndex(parts);
  return i === undefined
    ? undefined
    : parts[i]!.replace(/^['"]|['"]$/gu, "")
        .split("/")
        .at(-1);
}
export function positional(parts: ReadonlyArray<string>, start: number): ReadonlyArray<string> {
  return parts.slice(start).filter((part) => {
    const value = part.replace(/^['"]|['"]$/gu, "");
    return !value.startsWith("-") && !/^\d+$/u.test(value) && !SEPARATORS.has(value);
  });
}

function withoutHeredocBodies(command: string, keepUnquoted: boolean): string {
  const lines = command.split(/\r?\n/u);
  const kept: string[] = [];
  let delimiter: string | undefined;
  let quoted = false;
  for (const line of lines) {
    if (delimiter !== undefined) {
      if (line.trim() === delimiter) delimiter = undefined;
      else if (
        !quoted &&
        keepUnquoted &&
        (/\$\(/u.test(line) || /(?:^|[;&|])\s*`[^`]*`/u.test(line))
      )
        kept.push(line);
      continue;
    }
    kept.push(line);
    const match = line.match(/<<-?\s*(['"]?)([A-Za-z_]\w*)\1(?:\s|$)/u);
    if (match !== null) {
      quoted = match[1] !== "";
      delimiter = match[2];
    }
  }
  return kept.join("\n");
}

export function shellTokens(command: string): ReadonlyArray<string> {
  command = withoutHeredocBodies(command, false);
  const out: string[] = [];
  let current = "";
  let quote: string | undefined;
  const flush = () => {
    if (current !== "") out.push(current);
    current = "";
  };
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i]!;
    if (quote !== undefined) {
      current += c;
      if (c === quote) quote = undefined;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      current += c;
      continue;
    }
    if (c === "\\" && command[i + 1] === "\n") {
      i += 1;
      continue;
    }
    if (c === "\n") {
      flush();
      out.push(";");
      continue;
    }
    if (/\s/u.test(c)) {
      flush();
      continue;
    }
    const op = command
      .slice(i)
      .match(/^(?:&&|\|\||>>|<<|&>|>&|>\||>|[;|() ])/u)?.[0]
      ?.trim();
    if (op) {
      flush();
      out.push(op);
      i += op.length - 1;
      continue;
    }
    current += c;
  }
  flush();
  return out;
}

export function nestedShellCommands(command: string): ReadonlyArray<string> {
  const unquoted = withoutHeredocBodies(command, true).replace(/'(?:[^'\\]|\\.)*'/gu, "");
  return [...unquoted.matchAll(/\$\(([^()]*)\)|`([^`]*)`/gu)].flatMap(
    (match) => match[1] ?? match[2] ?? [],
  );
}
