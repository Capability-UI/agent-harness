#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const FLAG = '--disable-warning=ExperimentalWarning';

if (!process.execArgv.includes(FLAG)) {
  const result = spawnSync(process.execPath, [FLAG, ...process.argv.slice(1)], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

const { runCli } = await import('./cli.js');
runCli(process.argv.slice(2)).then(
  code => process.exit(code),
  error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
