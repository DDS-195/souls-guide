<script setup lang="ts">
/**
 * AppEmpty — 统一列表状态组件（加载中 / 错误 / 空态，2026-08-16 组件复用改造）
 * 收编此前 10+ 处手写的三件套（"加载中..." / 错误+重试 / 图标+文案）。
 * 用法：<AppEmpty :loading="loading" :error="error" empty-text="暂无待审核文章" icon="🗡️" @retry="load" />
 */
defineProps<{
  loading?: boolean
  error?: string
  /** 空态文案 */
  emptyText?: string
  /** 空态图标（emoji），默认 📜 */
  icon?: string
  /** 错误态重试按钮文案 */
  retryText?: string
}>()

defineEmits<{ (e: 'retry'): void }>()
</script>

<template>
  <div v-if="loading" class="ae-box">
    <span class="ae-loading">加载中...</span>
  </div>
  <div v-else-if="error" class="ae-box">
    <span class="ae-msg">{{ error }}</span>
    <button class="ae-btn" @click="$emit('retry')">{{ retryText || '重新加载' }}</button>
  </div>
  <div v-else class="ae-box">
    <div class="ae-icon">{{ icon || '📜' }}</div>
    <p class="ae-msg">{{ emptyText || '暂无内容' }}</p>
  </div>
</template>

<style scoped>
.ae-box {
  text-align: center;
  color: var(--text-muted);
  padding: 60px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.ae-loading {
  font-size: 0.9rem;
}
.ae-icon {
  font-size: 3rem;
  opacity: 0.2;
}
.ae-msg {
  margin: 0;
  font-size: 0.9rem;
}
.ae-btn {
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 0.8rem;
  cursor: pointer;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-family: inherit;
  transition: all var(--transition-fast);
}
.ae-btn:hover {
  color: var(--text-primary);
  border-color: var(--text-muted);
}
</style>
