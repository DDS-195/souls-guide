<script setup lang="ts">
/**
 * AppModal — 统一弹窗组件（2026-08-16 组件复用改造）
 * 收编此前 6 种手写弹窗（nd-overlay/apply-ov/ov/del-ov/modal-overlay 等），
 * 统一遮罩点击关闭 + Teleport + 设计变量样式。
 * 用法：<AppModal :title="'驳回文章'" @close="x = null">…内容…</AppModal>
 */
defineProps<{
  /** 弹窗标题（可选，不传则不显示标题行） */
  title?: string
  /** 卡片最大宽度，默认 420px */
  maxWidth?: string
}>()

defineEmits<{ (e: 'close'): void }>()
</script>

<template>
  <Teleport to="body">
    <div class="am-overlay" @click.self="$emit('close')">
      <div class="am-card" :style="{ maxWidth: maxWidth || '420px' }">
        <div v-if="title" class="am-title">{{ title }}</div>
        <slot />
      </div>
    </div>
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
</style>
