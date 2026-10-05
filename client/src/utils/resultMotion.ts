export type ResultSnapshot = { id: string; rect: DOMRect; element: HTMLElement }

export function captureResultLayout(element: HTMLElement | null): ResultSnapshot[] {
  if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return []
  return Array.from(element.querySelectorAll<HTMLElement>('.article-feed > .card[data-post-id]'))
    .map(card => ({ id: card.dataset.postId!, rect: card.getBoundingClientRect(), element: card }))
    .filter(item => item.rect.bottom > 0 && item.rect.top < window.innerHeight)
    .slice(0, 12)
}

/** Called only after the latest successful user-requested results commit. */
export function playResultTransition(element: HTMLElement | null, previous: ResultSnapshot[] = []) {
  if (!element?.isConnected || typeof element.animate !== 'function' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  try {
    const allCards = Array.from(element.querySelectorAll<HTMLElement>('.article-feed > .card'))
    const cards = allCards.filter(card => {
      if (typeof card.getBoundingClientRect !== 'function') return true
      const rect = card.getBoundingClientRect()
      return rect.bottom > 0 && rect.top < window.innerHeight
    }).slice(0, 6)
    const targets = cards.length ? cards : allCards.length ? [] : [element]
    let entering = 0
    targets.forEach(target => {
      target.getAnimations().forEach(animation => animation.cancel())
      const source = previous.find(item => item.id === target.dataset?.postId)
      if (source) {
        const rect = target.getBoundingClientRect()
        const x = source.rect.left - rect.left
        const y = source.rect.top - rect.top
        if (Math.abs(x) + Math.abs(y) > 1) target.animate([
          { transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' },
        ], { duration: 280, easing: 'cubic-bezier(.2,.7,.3,1)' })
        return
      }
      target.animate([
        { opacity: 0, transform: 'translateY(9px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: 280, delay: entering++ * 36, fill: 'backwards', easing: 'cubic-bezier(.2,.7,.3,1)' })
    })
    const ids = new Set(allCards.map(card => card.dataset?.postId))
    previous.filter(item => !ids.has(item.id)).slice(0, 6).forEach(item => {
      const ghost = item.element.cloneNode(true) as HTMLElement
      ghost.inert = true
      ghost.setAttribute('aria-hidden', 'true')
      ghost.classList.add('result-exit-ghost')
      Object.assign(ghost.style, {
        position: 'fixed', left: `${item.rect.left}px`, top: `${item.rect.top}px`,
        width: `${item.rect.width}px`, height: `${item.rect.height}px`, margin: '0',
        pointerEvents: 'none', zIndex: '30',
      })
      try {
        document.body.appendChild(ghost)
        const animation = ghost.animate([{ opacity: .6, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.97)' }], { duration: 140, fill: 'forwards' })
        void animation.finished.then(() => ghost.remove(), () => ghost.remove())
      } catch { ghost.remove() }
    })
  } catch { /* Decorative feedback must never prevent reading results. */ }
}
