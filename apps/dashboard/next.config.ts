import type { NextConfig } from "next";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(path.resolve(__dirname, "..", ".."));

const nextConfig: NextConfig = {
  compiler: {
    styledComponents: true,
  },
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
