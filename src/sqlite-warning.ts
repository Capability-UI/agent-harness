/** Mute Node's experimental `node:sqlite` warning. Import before CUP/sqlite. */

function isSqliteExperimental(warning: unknown, extra: unknown[]): boolean {
  const message =
    typeof warning === 'string'
      ? warning
      : warning instanceof Error
        ? warning.message
        : String(warning ?? '');
  const nameArg = extra[0];
  const name =
    typeof nameArg === 'string'
      ? nameArg
      : warning instanceof Error
        ? warning.name
        : '';
  if (/sqlite/i.test(message) && /experimental/i.test(`${name} ${message}`)) return true;
  return false;
}

const originalEmitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: unknown, ...args: unknown[]) => {
  if (isSqliteExperimental(warning, args)) return;
  return (originalEmitWarning as (...params: unknown[]) => void)(warning, ...args);
}) as typeof process.emitWarning;

const originalEmit = process.emit.bind(process);
process.emit = ((event: string | symbol, ...args: unknown[]) => {
  if (event === 'warning' && isSqliteExperimental(args[0], args.slice(1))) return false;
  return (originalEmit as (...params: unknown[]) => unknown)(event, ...args);
}) as typeof process.emit;
