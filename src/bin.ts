/** The command line's entry, what `pnpm run build` bundles; `cli.ts` holds the commands so the tests can drive them. */
import { main } from './cli.js';

const code = await main(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(`${text}\n`),
  stderr: (text) => process.stderr.write(`${text}\n`),
  env: process.env,
});
process.exitCode = code;
