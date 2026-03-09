import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  // Ensure the pdfjs worker file is included in the Vercel serverless bundle.
  // Without this, the worker file is missing at runtime and pdfjs falls back
  // to a CDN-fetched worker at a different version, causing version mismatch.
  outputFileTracingIncludes: {
    "/api/documents/upload": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },
};

export default nextConfig;
