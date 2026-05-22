/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    config.externals.push({
      canvg: 'canvg',
      html2canvas: 'html2canvas',
      dompurify: 'dompurify',
    })
    return config
  },
}

module.exports = nextConfig

