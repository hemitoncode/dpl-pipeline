import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The rule lexicon is read from disk at runtime by the API routes; make
  // sure it ships with serverless/standalone output.
  outputFileTracingIncludes: {
    "/api/**": ["./rules/**"],
  },
};

export default nextConfig;
