import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse ships its own pdf.js worker; bundling breaks the worker path.
  serverExternalPackages: ["pdf-parse", "mammoth"],
};

export default nextConfig;
