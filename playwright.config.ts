import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/e2e', timeout: 90000, workers: 1, fullyParallel: false, reporter: 'list', use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' } });
