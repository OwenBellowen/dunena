/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  // All docs are served under /docs by the Dunena server
  basePath: '/docs',
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  // Static images from public/ referenced via /docs/logo.svg etc.
  images: { unoptimized: true },
};

export default nextConfig;
