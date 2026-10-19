import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts', 'bot/test/**/*.test.js'],
		environment: 'node',
		testTimeout: 15000,
		setupFiles: ['test/support/setup.ts'],
	},
});
