<script setup lang="ts">
defineProps<{ open: boolean }>()
</script>

<template>
  <Transition name="expand-panel">
    <div v-if="open" class="expand-panel"><div class="expand-panel-inner"><slot /></div></div>
  </Transition>
</template>

<style scoped>
.expand-panel { display: grid; grid-template-rows: 1fr; }
.expand-panel-inner { min-height: 0; overflow: hidden; }
.expand-panel-enter-active, .expand-panel-leave-active { transition: grid-template-rows 220ms var(--motion-ease), opacity 180ms ease; }
.expand-panel-enter-from, .expand-panel-leave-to { grid-template-rows: 0fr; opacity: 0; }
.expand-panel-leave-active { pointer-events: none; }
@media (prefers-reduced-motion: reduce) { .expand-panel-enter-active, .expand-panel-leave-active { transition: none; } }
</style>
