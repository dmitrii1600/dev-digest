import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001",
  },
  // The vendored `@devdigest/shared` is the server's ESM source, so its barrel imports
  // `./contracts/findings.js` for `findings.ts`. tsc and vitest map that; webpack does not,
  // and the first *value* import of the barrel (EVAL_CASE_LIMITS) broke `next dev`/`build`.
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default withNextIntl(nextConfig);
