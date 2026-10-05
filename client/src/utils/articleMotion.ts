type TitleSnapshot = { id: string; rect: DOMRect; text: string; location: string; time: number }
let origin: TitleSnapshot | null = null
let returning: TitleSnapshot | null = null
let arrivalUsed = false
let cancelActive: (() => void) | null = null

function enabled() { return !window.matchMedia('(prefers-reduced-motion: reduce)').matches }
function snapshot(id: string, title: HTMLElement, location: string): TitleSnapshot {
  return { id, rect: title.getBoundingClientRect(), text: title.textContent || '', location, time: Date.now() }
}
export function captureArticleOrigin(event: MouseEvent, id: number | undefined, location: string) {
  if (!id || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
  cancelActive?.()
  const title = event.currentTarget as HTMLElement
  // Return navigation is functional state, even when decorative motion is disabled.
  origin = snapshot(String(id), title, location)
  returning = null
  arrivalUsed = false
}
export function prepareArticleReturn(from: string, to: string, location: string) {
  cancelActive?.()
  returning = null
  if (!from.startsWith('/post/') || to !== '/' || !origin || origin.location !== location || !enabled()) return
  const title = document.querySelector<HTMLElement>('[data-article-title]')
  if (title && from === `/post/${origin.id}`) returning = snapshot(origin.id, title, location)
}
function transfer(source: TitleSnapshot, target: HTMLElement) {
  if (!enabled() || !target.isConnected || typeof target.animate !== 'function' || Date.now() - source.time > 10000) return
  const rect = target.getBoundingClientRect()
  if (!rect.width || !rect.height || source.rect.bottom < 0 || source.rect.top > window.innerHeight) return
  cancelActive?.()
  const style = getComputedStyle(target)
  const clone = document.createElement('div')
  clone.textContent = target.textContent || source.text
  clone.setAttribute('aria-hidden', 'true')
  clone.className = 'article-title-flight'
  Object.assign(clone.style, {
    position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`,
    font: style.font, lineHeight: style.lineHeight, color: style.color, letterSpacing: style.letterSpacing,
    transformOrigin: 'top left', pointerEvents: 'none', zIndex: '9000', margin: '0',
  })
  const originalOpacity = target.style.opacity
  let cleaned = false
  let animation: Animation | null = null
  function clean() {
    if (cleaned) return
    cleaned = true
    animation?.cancel()
    clone.remove()
    target.style.opacity = originalOpacity
    if (cancelActive === clean) cancelActive = null
  }
  try {
    document.body.appendChild(clone)
    target.style.opacity = '0'
    cancelActive = clean
    const scale = Math.max(.4, Math.min(1.8, source.rect.width / rect.width))
    animation = clone.animate([
      { transform: `translate(${source.rect.left - rect.left}px, ${source.rect.top - rect.top}px) scale(${scale})`, opacity: .65 },
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
    ], { duration: 320, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both' })
    void animation.finished.then(clean, clean)
  } catch { clean() }
}
export function playArticleArrival(id: number, target: HTMLElement | null) {
  if (target && origin?.id === String(id) && !arrivalUsed) { arrivalUsed = true; transfer(origin, target) }
}
export function articleReturnLocation(id: string) {
  return origin?.id === id && Date.now() - origin.time < 30 * 60 * 1000 ? origin.location : null
}
export function playArticleReturn(root: HTMLElement | null) {
  if (!root || !returning) return
  const source = returning
  returning = null
  const target = root.querySelector<HTMLElement>(`[data-post-id="${source.id}"] .card-title a`)
  if (target) transfer(source, target)
}
