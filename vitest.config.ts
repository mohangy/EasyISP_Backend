import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.test.ts', 'src/__tests__/**/*.ts'],
        exclude: ['node_modules', 'dist'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            include: ['src/**/*.ts'],
            exclude: [
                'src/**/*.test.ts',
                'src/__tests__/**',
                'src/index.ts',
            ],
        },
        testTimeout: 30000,
        hookTimeout: 30000,
    },
});
