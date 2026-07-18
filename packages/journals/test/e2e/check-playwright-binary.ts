import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';

const executablePath = chromium.executablePath();

if (existsSync(executablePath)) {
  process.exit(0);
}

console.error(
  `[journals:e2e] Missing Playwright Chromium binary at: ${executablePath}`
);
process.exit(1);
