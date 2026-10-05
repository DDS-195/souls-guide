export function imageVariant(url: string | undefined | null, width: 480 | 640 | 800 | 960 | 1280) {
  return url && /^\/uploads\/images\/[A-Za-z0-9/_-]+\.(png|jpe?g|webp)$/i.test(url)
    ? `${url}?w=${width}` : url || undefined
}
export function imageSrcset(url: string | undefined | null, maxWidth = 1280) {
  if (!url || imageVariant(url, 480) === url) return undefined
  return ([480, 640, 800, 960, 1280] as const).filter(w => w <= maxWidth).map(w => `${imageVariant(url, w)} ${w}w`).join(', ')
}
