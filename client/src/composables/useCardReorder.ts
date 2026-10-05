import { computed, onBeforeUnmount, ref, type Ref } from 'vue'

/** Pointer-based sorting: keep DOM order stable until the drop animation finishes. */
export function useCardReorder<T extends { id: number }>(
  items: Ref<T[]>,
  blocked: () => boolean,
  commit: (next: T[], before: T[]) => Promise<void>,
) {
  const list = ref<HTMLElement | null>(null)
  const activeId = ref<number | null>(null)
  const target = ref(-1)
  const offset = ref(0)
  const settling = ref(false)
  const announcement = ref('')
  const active = computed(() => activeId.value !== null)
  let source = -1
  let startY = 0
  let pointerY = 0
  let initialScroll = 0
  let pointerId = -1
  let handle: HTMLElement | null = null
  let rects: { top: number; height: number }[] = []
  let before: T[] = []
  let frame = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let alive = true
  let moved = false
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

  function shift(index: number) {
    if (!active.value) return 0
    if (index === source) return offset.value
    const gap = rects.length > 1 ? rects[1]!.top - rects[0]!.top - rects[0]!.height : 0
    const step = rects[source]!.height + gap
    if (source < target.value && index > source && index <= target.value) return -step
    if (source > target.value && index >= target.value && index < source) return step
    return 0
  }
  function style(index: number) {
    return active.value ? { transform: `translate3d(0, ${shift(index)}px, 0)` } : undefined
  }
  function updatePosition() {
    offset.value = pointerY - startY + window.scrollY - initialScroll
    const center = rects[source]!.top + rects[source]!.height / 2 + offset.value
    let next = source
    if (offset.value > 0) {
      while (next + 1 < rects.length && center > rects[next + 1]!.top + rects[next + 1]!.height / 2) next++
    } else {
      while (next > 0 && center < rects[next - 1]!.top + rects[next - 1]!.height / 2) next--
    }
    if (next !== target.value) {
      target.value = next
      announcement.value = `移至第 ${next + 1} 位，共 ${before.length} 项`
    }
  }
  function tick() {
    if (!active.value || settling.value) return
    const edge = 72
    const speed =
      pointerY < edge
        ? -Math.min(12, (edge - pointerY) / 6)
        : pointerY > window.innerHeight - edge
          ? Math.min(12, (pointerY - window.innerHeight + edge) / 6)
          : 0
    if (speed && moved) window.scrollBy(0, speed)
    updatePosition()
    frame = requestAnimationFrame(tick)
  }
  function move(event: PointerEvent) {
    if (event.pointerId !== pointerId || settling.value) return
    event.preventDefault()
    pointerY = event.clientY
    if (Math.abs(pointerY - startY) > 4) moved = true
    updatePosition()
  }
  function detach() {
    cancelAnimationFrame(frame)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
    window.removeEventListener('keydown', escape)
    window.removeEventListener('blur', cancel)
    window.removeEventListener('resize', cancel)
    if (handle?.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
    handle = null
  }
  function reset() {
    activeId.value = null
    target.value = -1
    offset.value = 0
    settling.value = false
  }
  function finish(cancelled: boolean) {
    if (!active.value || settling.value) return
    detach()
    settling.value = true
    const destination = cancelled ? source : target.value
    if (cancelled) target.value = source
    offset.value =
      destination > source
        ? rects[destination]!.top + rects[destination]!.height - rects[source]!.top - rects[source]!.height
        : rects[destination]!.top - rects[source]!.top
    timer = setTimeout(
      () => {
        if (!alive) return
        const previous = before
        reset()
        if (cancelled || source === destination) {
          announcement.value = cancelled ? '已取消排序' : '顺序未变化'
          return
        }
        const next = [...previous]
        const [item] = next.splice(source, 1)
        next.splice(destination, 0, item!)
        void commit(next, previous)
      },
      reduced() ? 0 : 180,
    )
  }
  function up(event: PointerEvent) {
    if (event.pointerId === pointerId) finish(false)
  }
  function cancel() {
    finish(true)
  }
  function escape(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      finish(true)
    }
  }
  function start(event: PointerEvent, id: number) {
    if (blocked() || active.value || !event.isPrimary || event.button !== 0) return
    const nodes = list.value?.querySelectorAll<HTMLElement>('[data-sort-card]')
    if (!nodes?.length) return
    before = [...items.value]
    source = before.findIndex((item) => item.id === id)
    if (source < 0 || nodes.length !== before.length) return
    rects = Array.from(nodes, (node) => {
      const rect = node.getBoundingClientRect()
      return { top: rect.top, height: rect.height }
    })
    event.preventDefault()
    handle = event.currentTarget as HTMLElement
    handle.focus({ preventScroll: true })
    pointerId = event.pointerId
    handle.setPointerCapture(pointerId)
    startY = pointerY = event.clientY
    moved = false
    initialScroll = window.scrollY
    target.value = source
    activeId.value = id
    announcement.value = `已抓取第 ${source + 1} 项，按 Escape 取消`
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', escape)
    window.addEventListener('blur', cancel)
    window.addEventListener('resize', cancel)
    frame = requestAnimationFrame(tick)
  }
  function keyboard(event: KeyboardEvent, index: number) {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    if (blocked() || active.value) return
    const destination = index + (event.key === 'ArrowUp' ? -1 : 1)
    if (destination < 0 || destination >= items.value.length) return
    const previous = [...items.value]
    const next = [...previous]
    const [item] = next.splice(index, 1)
    next.splice(destination, 0, item!)
    announcement.value = `移至第 ${destination + 1} 位`
    void commit(next, previous)
  }
  onBeforeUnmount(() => {
    alive = false
    detach()
    clearTimeout(timer)
  })
  return { list, activeId, active, settling, announcement, style, start, keyboard }
}
