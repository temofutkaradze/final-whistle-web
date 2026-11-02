// Security headers for every page. In production (npm run build / npm start) a Content-Security-Policy is added as well.
// It is not used in `npm run dev`, because the development server needs things the policy would block (live reload).

const isProd = process.env.NODE_ENV === "production";

// What the pages may load:
//  - scripts and styles from this site (Next.js writes small inline scripts, and the theme switch is inline: 'unsafe-inline')
//  - Google Fonts (the fonts of the site and of the template previews)
//  - pictures from this site, data: URIs (logos, template previews) and blob:
//  - nothing from other sites, no plug-ins, no framing of the site by others, forms only to this site
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  ...(isProd
    ? [
        { key: "Content-Security-Policy", value: contentSecurityPolicy },
        // Only means something over https (browsers ignore it on http://localhost); 180 days, no subdomains, no preload.
        { key: "Strict-Transport-Security", value: "max-age=15552000" },
      ]
    : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false, // do not announce "X-Powered-By: Next.js"
  // The logo upload (up to 5 MB) is sent with a dashboard form.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
