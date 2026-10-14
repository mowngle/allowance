// Stand-in for SvelteKit's `$env/dynamic/private`, which only exists inside a
// Vite/SvelteKit build. Aliased in vitest.config.ts so server modules that read
// private env vars (push.ts and anything importing it) are testable.

export const env = process.env as Record<string, string | undefined>;
