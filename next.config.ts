import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  serverExternalPackages: [
    "@napi-rs/canvas",
    "@tesseract.js-data/eng",
    "better-sqlite3",
    "tesseract.js",
  ],
};

export default nextConfig;
