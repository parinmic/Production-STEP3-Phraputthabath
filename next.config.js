/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  webpack: (config) => {
    config.externals.push({
      canvg: 'canvg',
      dompurify: 'dompurify',
    })
    return config
  },
}

module.exports = nextConfig

