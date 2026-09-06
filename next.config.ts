import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ["@napi-rs/canvas", "better-sqlite3"],
};

export default nextConfig;
