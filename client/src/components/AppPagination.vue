<script setup lang="ts">
/**
 * AppPagination — 统一分页控件（2026-08-16 组件复用改造）
 * 收编此前 5 份复制粘贴的「‹ 上一页 / x 页 / 下一页 ›」。
 * 用法：<AppPagination :page="page" :page-count="pageCount" @change="goPage" />
 */
defineProps<{
  page: number
  pageCount: number
}>()

defineEmits<{ (e: 'change', page: number): void }>()
</script>

<template>
  <div v-if="pageCount > 1" class="pg">
    <button class="pg-btn" :disabled="page <= 1" @click="$emit('change', page - 1)">‹ 上一页</button>
    <span class="pg-info">{{ page }} / {{ pageCount }}</span>
    <button class="pg-btn" :disabled="page >= pageCount" @click="$emit('change', page + 1)">下一页 ›</button>
  </div>
</template>

<style scoped>
.pg {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 14px;
  margin-top: 20px;
}
.pg-info {
  font-size: 0.8rem;
  color: var(--text-muted);
}
.pg-btn {
  padding: 5px 14px;
  border-radius: 6px;
  font-size: 0.78rem;
  cursor: pointer;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-family: inherit;
  transition: all var(--transition-fast);
}
.pg-btn:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: var(--text-muted);
}
.pg-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
