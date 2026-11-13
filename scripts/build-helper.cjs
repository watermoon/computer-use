'use strict';
// Builds the Windows native helper with the .NET Framework 4 compiler.
// The output lands in the repository root because windows-computer-use.cjs
// resolves it as path.join(__dirname, '../ComputerUse.exe').
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'ComputerUse.exe');
const compiler = path.join(process.env.SystemRoot || 'C:\\Windows',
  'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');

if (process.platform !== 'win32') {
  console.error('The native helper build is Windows-only; macOS uses native/MacComputerUse.swift via swiftc.');
  process.exit(1);
}
if (!fs.existsSync(compiler)) {
  console.error(`csc.exe not found: ${compiler}`);
  process.exit(1);
}

execFileSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/optimize+',
  '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.Web.Extensions.dll',
  '/out:' + output, path.join(root, 'native', 'ComputerUse.cs')], {stdio: 'inherit'});

console.log(output);
