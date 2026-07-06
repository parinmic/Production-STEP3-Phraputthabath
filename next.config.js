/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  webpack: (config, { dev }) => {
    config.externals.push({
      canvg: 'canvg',
      dompurify: 'dompurify',
    })
    if (dev) {
      // Persistent filesystem cache keeps corrupting on this machine
      // (ENOENT/MODULE_NOT_FOUND in .next/server), likely AV locking
      // cache files mid-write. Disabling it trades slower rebuilds
      // for a dev server that doesn't need manual .next wipes.
      config.cache = false
    }
    return config
  },
}

module.exports = nextConfig

