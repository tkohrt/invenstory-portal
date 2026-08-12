import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "connect-src 'self' https://dafofmvbbggrmyfnjspg.supabase.co https://*.supabase.co",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ") },
];

const nextConfig: NextConfig = {
  // pdf-parse ships its own pdf.js worker; bundling breaks the worker path.
  serverExternalPackages: ["unpdf", "mammoth"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // The Inven(s)tory page was originally scaffolded at /library. Keep old links working.
  async redirects() {
    return [{ source: "/library", destination: "/invenstory", permanent: true }];
  },
};

export default nextConfig;
