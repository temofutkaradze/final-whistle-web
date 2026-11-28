// Security headers for every page; src/proxy.ts supplies a request-specific nonce CSP.
// Its development policy permits the eval and loopback WebSockets required for development.

const isProd = process.env.NODE_ENV === "production";

// What the pages may load:
//  - scripts carry a per-request nonce; existing inline styles remain compatible.
//  - Google Fonts (the fonts of the site and of the template previews)
//  - pictures from this site, data: URIs (logos, template previews) and blob:
//  - nothing from other sites, no plug-ins, no framing of the site by others, forms only to this site
// Nonce-based script policy is generated for each request in src/proxy.ts.

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  ...(isProd
    ? [
        // Request-specific nonce CSP is supplied by src/proxy.ts.
        // Only means something over https (browsers ignore it on http://localhost); 180 days, no subdomains, no preload.
        { key: "Strict-Transport-Security", value: "max-age=15552000" },
      ]
    : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false, // do not announce "X-Powered-By: Next.js"
  // These remain local runtime data, never files to package with a website build.
  // Built-in render/assets, public fonts and application dependencies remain traceable.
  outputFileTracingExcludes: {'/*':[
    './storage/**/*','./render/output/**/*','./render/rendered/**/*','./render/cache/**/*',
    './preview-images/**/*','./docs/previews/**/*','./tests/fixtures/photos/**/*',
    './.env','./.env.*','./*.log','./render/*.backup.js',
  ]},
  experimental: { agentUpgrade: 'security', serverActions: { bodySizeLimit: "6mb" } },
  // The logo upload (up to 5 MB) is sent with a dashboard form.
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
