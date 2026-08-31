// 图片压缩工具（设计文档 10.1 契约，2026-08-08 实现）：
// 前端 Canvas 压缩 → WebP；封面 800px/quality 0.85，内嵌 1920px/0.8；压缩后目标 ≤500KB
// （5MB 仍为后端 multer 兜底上限，见 10.1/D8）

export interface CompressOptions {
  /** 目标最大宽度（等比缩放，不放大） */
  maxWidth?: number
  /** 初始质量 0~1 */
  quality?: number
  /** 目标大小上限（字节），默认 500KB */
  maxBytes?: number
}

const DEFAULT_MAX_BYTES = 500 * 1024 // 500KB（契约 10.1）
const MIN_QUALITY = 0.4 // 降质量下限（再低肉眼可感知，转用缩宽）

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片解码失败'))
    }
    img.src = url
  })
}

/** 按 maxWidth 等比缩放绘制（scale=min(1, ...) 只缩不放） */
function drawScaled(img: HTMLImageElement, maxWidth: number): HTMLCanvasElement {
  const scale = Math.min(1, maxWidth / img.naturalWidth)
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D 不可用')
  ctx.drawImage(img, 0, 0, w, h)
  return canvas
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
}

/**
 * 压缩图片：解码 → 缩放 → WebP 编码，大小超限时先降质量、再缩宽度迭代
 * 失败（解码失败/不支持 webp 编码）时原样返回，由后端 5MB 兜底
 */
export async function compressImage(file: File, opts: CompressOptions = {}): Promise<File> {
  const { maxWidth = 1920, quality = 0.8, maxBytes = DEFAULT_MAX_BYTES } = opts
  try {
    const img = await loadImage(file)
    let width = Math.min(maxWidth, img.naturalWidth)
    let canvas = drawScaled(img, width)
    let q = quality
    let blob = await canvasToBlob(canvas, q)

    // 降质量迭代至 ≤maxBytes（下限 MIN_QUALITY）
    while (blob && blob.size > maxBytes && q > MIN_QUALITY) {
      q = Math.max(MIN_QUALITY, +(q - 0.1).toFixed(2))
      blob = await canvasToBlob(canvas, q)
    }
    // 仍超限 → 按 0.8 倍缩宽重试（下限 = 目标宽/3，避免无限缩小）
    while (blob && blob.size > maxBytes && width > Math.max(200, maxWidth / 3)) {
      width = Math.round(width * 0.8)
      canvas = drawScaled(img, width)
      q = quality
      blob = await canvasToBlob(canvas, q)
      while (blob && blob.size > maxBytes && q > MIN_QUALITY) {
        q = Math.max(MIN_QUALITY, +(q - 0.1).toFixed(2))
        blob = await canvasToBlob(canvas, q)
      }
    }

    if (!blob) return file // 浏览器不支持 webp 编码 → 原样上传（后端 5MB 兜底）
    const name = file.name.replace(/\.[^.]+$/, '') + '.webp'
    return new File([blob], name, { type: 'image/webp' })
  } catch {
    return file // 解码失败等异常 → 原样上传
  }
}
