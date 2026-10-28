#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

console.log('--- 1/2 Spouštím typovou kontrolu (tsc --noEmit) ---');
const tsc = spawnSync('npm', ['run', 'lint'], { stdio: 'inherit', shell: true });
if (tsc.status !== 0) {
  console.error('Typová kontrola selhala!');
  process.exit(tsc.status || 1);
}

console.log('--- 2/2 Spouštím unit testy (node --test) ---');
const tests = spawnSync('node', ['--test'], { stdio: 'inherit', shell: true });
if (tests.status !== 0) {
  console.error('Testy selhaly!');
  process.exit(tests.status || 1);
}

console.log('✓ Všechny kontroly a testy prošly s 0 chybami.');
