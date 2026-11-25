/**
 * The command line's entry, what `pnpm run build` bundles; `cli.ts` holds the
 * commands so the tests can drive them.
 *
 * `watch` and `serve` run until stopped. Both stop on SIGINT and SIGTERM.
 * `watch` also stops when its standard input closes, unless that is a terminal:
 * the desktop program's Tools list ends what it started by closing the pipe, so
 * a shell killed outright leaves no process behind (Armature's lint plan §10,
 * step 1). `serve` ignores its standard input, which a container gives as
 * already closed.
 */
import { main } from './cli.js';

const argv = process.argv.slice(2);
const controller = new AbortController();
const stop = () => controller.abort();
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

const followsStdin = argv[0] === 'watch' && !process.stdin.isTTY;
if (followsStdin) {
  process.stdin.on('end', stop);
  process.stdin.on('close', stop);
  process.stdin.resume();
}

const code = await main(argv, {
  stdout: (text) => process.stdout.write(`${text}\n`),
  stderr: (text) => process.stderr.write(`${text}\n`),
  env: process.env,
  signal: controller.signal,
});
if (followsStdin) process.stdin.destroy();
process.exitCode = code;
