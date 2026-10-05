import { nextTick, onUnmounted, ref, watch, type CSSProperties, type Ref, type WatchSource } from 'vue'

/** One shared highlight follows the selected control, including scrollable and wrapped groups. */
export function useSelectionIndicator(container: Ref<HTMLElement | null>, sources: WatchSource[], selector = '.active') {
  const style = ref<CSSProperties>({})
  const ready = ref(false)
  const moving = ref(false)
  let observer: ResizeObserver | null = null
  let frame = 0
  let disposed = false
  function measure() {
    const parent = container.value
    const active = parent?.querySelector<HTMLElement>(selector)
    if (!parent || !active) { ready.value = false; return }
    style.value = {
      width: `${active.offsetWidth}px`, height: `${active.offsetHeight}px`,
      transform: `translate3d(${active.offsetLeft}px, ${active.offsetTop}px, 0)`,
    }
    ready.value = true
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => { moving.value = true })
  }
  watch([container, ...sources], async () => {
    await nextTick()
    if (disposed) return
    observer?.disconnect()
    if (container.value && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure)
      observer.observe(container.value)
      container.value.querySelectorAll('button').forEach(el => observer!.observe(el))
    }
    measure()
  }, { immediate: true, flush: 'post' })
  onUnmounted(() => { disposed = true; observer?.disconnect(); cancelAnimationFrame(frame) })
  return { style, ready, moving }
}
