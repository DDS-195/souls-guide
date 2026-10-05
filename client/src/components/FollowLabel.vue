<script setup lang="ts">
defineProps<{ followed: boolean }>()
</script>

<template>
  <span class="follow-label"><Transition name="follow-label"><span :key="String(followed)">{{ followed ? '✓ 已关注' : '+ 关注' }}</span></Transition></span>
</template>

<style scoped>
.follow-label { display: inline-grid; min-width: 4.8em; white-space: nowrap; overflow: hidden; vertical-align: middle; }
.follow-label > span { grid-area: 1 / 1; }
.follow-label-enter-active { transition: transform 180ms var(--motion-ease), opacity 180ms ease; }
.follow-label-leave-active { transition: opacity 100ms ease; }
.follow-label-enter-from { opacity: 0; transform: translateY(5px); }
.follow-label-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .follow-label-enter-active, .follow-label-leave-active { transition: none; } }
</style>
