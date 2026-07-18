const VALUE_OPTIONS = new Set([
  "--conversation",
  "--format",
  "--model",
  "--out",
  "--provider",
  "--root",
  "--store",
  "--target",
]);

export function optionValue(args: string[], option: string): string | undefined {
  const index = args.indexOf(option);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

export function positionalArguments(args: string[]): string[] {
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) {
      continue;
    }
    if (VALUE_OPTIONS.has(argument)) {
      index += 1;
      continue;
    }
    if (!argument.startsWith("--")) {
      positionals.push(argument);
    }
  }
  return positionals;
}
