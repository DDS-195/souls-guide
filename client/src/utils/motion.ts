/** Optional feedback only: never delays data updates or initial image visibility. */
export function playFeedback(element: HTMLElement | SVGElement | null, kind: 'confirm' | 'image') {
  if (!element?.isConnected || typeof element.animate !== 'function' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  element.getAnimations().forEach(animation => animation.cancel())
  element.animate(kind === 'confirm'
    ? [{ transform: 'scale(1)' }, { transform: 'scale(1.18)', offset: 0.4 }, { transform: 'scale(1)' }]
    : [{ opacity: 0.65 }, { opacity: 1 }],
  { duration: kind === 'confirm' ? 240 : 160, easing: 'cubic-bezier(.2,.7,.3,1)' })
}

/** Bounded comment insertion/removal; callers enable it only after a confirmed mutation. */
export function animateComment(element: Element, done: () => void, enabled: boolean, leaving = false) {
  const el = element as HTMLElement
  if (!enabled || !el.isConnected || typeof el.animate !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return }
  const style = getComputedStyle(el)
  const full = { height: `${el.getBoundingClientRect().height}px`, opacity: 1, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, marginTop: style.marginTop, transform: 'translateY(0)' }
  const collapsed = { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', transform: 'translateY(6px)' }
  const overflow = el.style.overflow
  el.style.overflow = 'hidden'
  let finished = false
  function finish() { if (finished) return; finished = true; el.style.overflow = overflow; done() }
  try {
    const animation = el.animate(leaving ? [full, collapsed] : [collapsed, full], { duration: leaving ? 180 : 240, easing: 'cubic-bezier(.2,.7,.3,1)' })
    void animation.finished.then(finish, finish)
  } catch { finish() }
}
