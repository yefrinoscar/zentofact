#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listen, parseArgs } from './agent.js';
import { listPrinters, printPdf } from './print.js';

const here = dirname(fileURLToPath(import.meta.url));

async function installLogin(config) {
  if (process.platform !== 'darwin') {
    throw new Error('install-login está hecho para macOS (LaunchAgent).');
  }
  const dir = join(homedir(), 'Library', 'LaunchAgents');
  await mkdir(dir, { recursive: true });
  const envFile = join(homedir(), '.zentofact-print.env');
  await writeFile(envFile, [
    `ZENTOFACT_API_URL=${config.api}`,
    `ZENTOFACT_PRINT_TOKEN=${config.token}`,
    `ZENTOFACT_PRINTER=${config.printer}`,
    '',
  ].join('\n'), { mode: 0o600 });
  const plist = join(dir, 'pe.zentofact.print-agent.plist');
  const agent = join(here, 'index.js');
  await writeFile(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>pe.zentofact.print-agent</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>WorkingDirectory</key><string>${homedir()}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ZENTOFACT_API_URL</key><string>${config.api}</string>
    <key>ZENTOFACT_PRINT_TOKEN</key><string>${config.token}</string>
    <key>ZENTOFACT_PRINTER</key><string>${config.printer}</string>
  </dict>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>node</string>
    <string>${agent}</string>
  </array>
  <key>StandardOutPath</key><string>${homedir()}/.zentofact-print/agent.log</string>
  <key>StandardErrorPath</key><string>${homedir()}/.zentofact-print/agent.log</string>
</dict>
</plist>
`);
  console.log(`LaunchAgent escrito en ${plist}`);
  console.log('Cárgalo con: launchctl load -w ' + plist);
}

const config = parseArgs(process.argv.slice(2));
if (!config.api && config.command !== 'list-printers') {
  console.error('Falta --api o ZENTOFACT_API_URL');
  process.exit(1);
}
if (config.command === 'list-printers') {
  const printers = await listPrinters();
  printers.forEach((name) => console.log(name));
} else if (config.command === 'install-login') {
  if (!config.token || !config.printer) {
    console.error('install-login necesita --token y --printer');
    process.exit(1);
  }
  await installLogin(config);
} else {
  if (!config.token) {
    console.error('Falta --token o ZENTOFACT_PRINT_TOKEN');
    process.exit(1);
  }
  await listen(config, { printPdf });
}
