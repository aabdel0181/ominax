export function shellTokens(command: string): ReadonlyArray<string> {
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
      .match(/^(?:&&|\|\||>>|<<|&>|>&|[;|() >])/u)?.[0]
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
  const unquoted = command.replace(/'(?:[^'\\]|\\.)*'/gu, "");
  return [...unquoted.matchAll(/\$\(([^()]*)\)|`([^`]*)`/gu)].flatMap(
    (match) => match[1] ?? match[2] ?? [],
  );
}
