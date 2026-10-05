const fs = require('fs/promises')
const path = require('path')

const EXTENSIONS = {
  jpeg: new Set(['.jpg', '.jpeg']),
  png: new Set(['.png']),
  gif: new Set(['.gif']),
  webp: new Set(['.webp']),
}

function detectImage(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg'
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return 'gif'
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp'
  return null
}

async function validateImageFile(file) {
  const handle = await fs.open(file.path, 'r')
  let bytes
  try {
    bytes = Buffer.alloc(16)
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
    bytes = bytes.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
  const type = detectImage(bytes)
  const ext = path.extname(file.originalname || file.path).toLowerCase()
  if (!type || !EXTENSIONS[type].has(ext)) {
    await fs.unlink(file.path).catch(() => {})
    const err = new Error('图片内容与文件格式不匹配')
    err.statusCode = 400
    err.code = 400
    throw err
  }
  return type
}

module.exports = { detectImage, validateImageFile }
