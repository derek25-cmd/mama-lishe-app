import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // The costing engine (src/core/costing/) is written NodeNext-style —
  // relative imports carry an explicit ".js" suffix even though the files
  // are .ts, which is what lets it run unmodified under plain `node`/tsx/
  // vitest (package.json's "type": "module" requires the extension there).
  // Webpack's default resolver takes a ".js" specifier literally and never
  // tries ".ts", so without this alias every such import 404s the moment
  // this code is pulled into the Next.js build (as of the Plans API, Task 5).
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
