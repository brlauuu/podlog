/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for the Docker multi-stage build — bundles server + node_modules
  output: "standalone",

  // Allow images from podcast CDNs (cover art)
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
  },
};

export default nextConfig;
