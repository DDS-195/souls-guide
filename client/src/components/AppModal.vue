<script setup lang="ts">
import { nextTick, onUnmounted, ref, useId, watch } from 'vue'
/**
 * AppModal — 统一弹窗组件（2026-08-16 组件复用改造）
 * 收编此前 6 种手写弹窗（nd-overlay/apply-ov/ov/del-ov/modal-overlay 等），
 * 统一遮罩点击关闭 + Teleport + 设计变量样式。
 * 用法：<AppModal :open="Boolean(x)" title="驳回文章" @close="x = null">…内容…</AppModal>
 */
const props = withDefaults(defineProps<{
  open?: boolean
  /** 弹窗标题（可选，不传则不显示标题行） */
  title?: string
  /** 卡片最大宽度，默认 420px */
  maxWidth?: string
}>(), { open: true, title: '', maxWidth: '420px' })

const emit = defineEmits<{ (e: 'close'): void }>()
const titleId = useId()
const card = ref<HTMLElement | null>(null)
let previousFocus: HTMLElement | null = null

function onKeydown(event: KeyboardEvent) {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  }
  if (event.key !== 'Tab' || !card.value) return
  const items = Array.from(
    card.value.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.getClientRects().length > 0)
  if (!items.length) {
    event.preventDefault()
    card.value.focus()
    return
  }
  const first = items[0]!
  const last = items[items.length - 1]!
  if (!card.value.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function restoreFocus() {
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
  previousFocus = null
}
watch(() => props.open, async (open) => {
  if (!open) {
    window.removeEventListener('keydown', onKeydown)
    restoreFocus()
    return
  }
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  window.addEventListener('keydown', onKeydown)
  await nextTick()
  if (!props.open) return
  const first = card.value?.querySelector<HTMLElement>(
    'input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled), [tabindex]:not([tabindex="-1"])',
  )
  ;(first || card.value)?.focus()
}, { immediate: true, flush: 'post' })

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  restoreFocus()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="am" appear>
    <div v-if="open" class="am-overlay" @click.self="$emit('close')">
      <div
        ref="card"
        class="am-card"
        role="dialog"
        tabindex="-1"
        aria-modal="true"
        :aria-labelledby="title ? titleId : undefined"
        :style="{ maxWidth: maxWidth || '420px' }"
      >
        <div v-if="title" :id="titleId" class="am-title">{{ title }}</div>
        <slot />
      </div>
    </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.am-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.am-card {
  width: 100%;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  padding: 18px;
}
.am-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--amber);
  margin-bottom: 10px;
}
.am-enter-active { transition: opacity 240ms ease; }
.am-leave-active { transition: opacity 160ms ease; pointer-events: none; }
.am-enter-active .am-card { transition: transform 240ms var(--motion-ease); }
.am-leave-active .am-card { transition: transform 160ms ease; }
.am-enter-active .am-title { transition: transform 180ms var(--motion-ease) 40ms, opacity 180ms ease 40ms; }
.am-enter-from .am-title { opacity: 0; transform: translateY(4px); }
.am-enter-from, .am-leave-to { opacity: 0; }
.am-enter-from .am-card { transform: translateY(16px) scale(.97); }
.am-leave-to .am-card { transform: translateY(6px) scale(.985); }
@media (prefers-reduced-motion: reduce) {
  .am-enter-active, .am-leave-active, .am-enter-active .am-card, .am-leave-active .am-card, .am-enter-active .am-title { transition: none; }
  .am-enter-from .am-card, .am-leave-to .am-card, .am-enter-from .am-title { transform: none; }
}
</style>
