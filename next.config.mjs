/** @type {import('next').NextConfig} */
const nextConfig = {
  // The logo upload (up to 5 MB) is sent with a dashboard form.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};

export default nextConfig;
