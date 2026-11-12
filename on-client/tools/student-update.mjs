import { runCli } from './install.mjs';

process.exitCode = await runCli(process.argv.slice(2), { studentUpdate: true });
