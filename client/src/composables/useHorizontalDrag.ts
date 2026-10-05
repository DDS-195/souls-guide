import { nextTick, onMounted, onUnmounted, ref, watch, type Ref, type WatchSource } from 'vue'

/** Touch keeps native scrolling; mouse dragging never accidentally selects a tab. */
export function useHorizontalDrag(container: Ref<HTMLElement | null>, sources: WatchSource[] = [], selector = '.active') {
  const dragging = ref(false)
  let drag: { id: number; x: number; left: number } | null = null
  let suppressClick = false
  let disposed = false
  function start(event: PointerEvent) {
    suppressClick = false
    const el = container.value
    if (!el || event.pointerType !== 'mouse' || event.button !== 0 || el.scrollWidth <= el.clientWidth) return
    drag = { id: event.pointerId, x: event.clientX, left: el.scrollLeft }
  }
  function move(event: PointerEvent) {
    const el = container.value
    if (!el || !drag || event.pointerId !== drag.id) return
    const distance = event.clientX - drag.x
    if (!dragging.value && Math.abs(distance) < 5) return
    dragging.value = true
    suppressClick = true
    event.preventDefault()
    el.scrollLeft = drag.left - distance
  }
  function end() { drag = null; dragging.value = false }
  function guardClick(event: MouseEvent) {
    if (suppressClick && event.detail !== 0) {
      event.preventDefault()
      event.stopPropagation()
    }
    suppressClick = false
  }
  function reveal(item: HTMLElement | null) {
    const el = container.value
    if (!el || !item) return
    const box = el.getBoundingClientRect()
    const rect = item.getBoundingClientRect()
    if (rect.left < box.left) el.scrollLeft += rect.left - box.left
    else if (rect.right > box.right) el.scrollLeft += rect.right - box.right
  }
  function focus(event: FocusEvent) {
    if (event.target instanceof HTMLElement) reveal(event.target.closest('button'))
  }
  function revealSelected() { reveal(container.value?.querySelector<HTMLElement>(selector) || null) }
  watch([container, ...sources], async () => {
    await nextTick()
    if (!disposed) revealSelected()
  }, { immediate: true, flush: 'post' })
  onMounted(() => {
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    window.addEventListener('blur', end)
    window.addEventListener('resize', revealSelected)
  })
  onUnmounted(() => {
    disposed = true
    end()
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    window.removeEventListener('blur', end)
    window.removeEventListener('resize', revealSelected)
  })
  return { dragging, start, guardClick, focus }
}
