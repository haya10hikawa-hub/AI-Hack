// Vitest runs server modules in Node. This explicit test-only alias preserves
// the production `server-only` boundary while allowing integration tests to
// exercise those modules outside Next.js' bundler.
export {};
