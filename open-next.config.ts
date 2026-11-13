// OpenNext (AWS) build configuration, read by `@opennextjs/aws@4.1.16 build`.
// Next.js ignores this file. Shape: `OpenNextConfig` and `DangerousOptions` in
// `@opennextjs/aws/types/open-next` (not imported, so the package stays a build-time
// tool run with npx rather than a project dependency).
const config = {
  // Default server function with OpenNext's default wrapper and converter.
  default: {},
  dangerous: {
    // Next.js applies next.config headers first and lets proxy.ts override them
    // (https://nextjs.org/docs/app/api-reference/file-conventions/proxy#execution-order).
    // OpenNext 4.1.16 defaults to the reverse, which replaced the proxy's
    // `Referrer-Policy: no-referrer` with the next.config value on every page.
    middlewareHeadersOverrideNextConfigHeaders: true,
  },
};

export default config;
