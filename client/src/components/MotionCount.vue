<script setup lang="ts">
import { ref, watch } from 'vue'
const props = defineProps<{ value: number }>()
const direction = ref('count-rise')
watch(() => props.value, (value, before) => { direction.value = value >= before ? 'count-rise' : 'count-fall' })
</script>

<template>
  <span class="motion-count" aria-live="polite" aria-atomic="true">
    <Transition :name="direction"><span :key="value" class="count-value">{{ value }}</span></Transition>
  </span>
</template>

<style scoped>
.motion-count { display: inline-grid; min-width: 1ch; overflow: hidden; vertical-align: middle; font-variant-numeric: tabular-nums; }
.count-value { grid-area: 1 / 1; }
.count-rise-enter-active, .count-fall-enter-active { transition: transform 200ms var(--motion-ease), opacity 200ms ease; }
.count-rise-leave-active, .count-fall-leave-active { transition: transform 140ms ease, opacity 140ms ease; }
.count-rise-enter-from, .count-fall-leave-to { opacity: 0; transform: translateY(75%); }
.count-rise-leave-to, .count-fall-enter-from { opacity: 0; transform: translateY(-75%); }
@media (prefers-reduced-motion: reduce) {
  .count-rise-enter-active, .count-fall-enter-active, .count-rise-leave-active, .count-fall-leave-active { transition: none; }
}
</style>
