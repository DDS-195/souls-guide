<script setup lang="ts">
defineProps<{ small?: boolean }>()
</script>

<template>
  <span class="video-cover-badge" :class="{ 'video-cover-badge--small': small }" role="img" aria-label="包含视频">
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5a.75.75 0 0 1 1.13-.65l10 6.5a.75.75 0 0 1 0 1.3l-10 6.5A.75.75 0 0 1 8 18.5z" />
    </svg>
  </span>
</template>

<style scoped>
.video-cover-badge {
  position: absolute;
  z-index: 3;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border: 1px solid rgba(255, 255, 255, .7);
  border-radius: 50%;
  background: rgba(10, 14, 20, .62);
  color: #fff;
  box-shadow: 0 2px 12px rgba(0, 0, 0, .28);
  pointer-events: none;
}
.video-cover-badge svg { width: 24px; height: 24px; }
@media (max-width: 767px) {
  .video-cover-badge { width: 42px; height: 42px; }
  .video-cover-badge svg { width: 22px; height: 22px; }
}
.video-cover-badge--small { width: 30px; height: 30px; }
.video-cover-badge--small svg { width: 18px; height: 18px; }
</style>
