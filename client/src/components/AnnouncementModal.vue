<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { adminApi } from '../api'

const visible = ref(false)
const announcement = ref<any>(null)

onMounted(async () => {
  try {
    const res = await adminApi.getLatestAnnouncement()
    if (!res.data) return
    const dismissed: number[] = JSON.parse(localStorage.getItem('dismissedAnnouncements') || '[]')
    if (!dismissed.includes(res.data.id)) {
      announcement.value = res.data
      visible.value = true
    }
  } catch {
    /* 公告接口失败静默：不弹窗不阻塞页面 */
  }
})

function dismiss() {
  visible.value = false
  const dismissed: number[] = JSON.parse(localStorage.getItem('dismissedAnnouncements') || '[]')
  dismissed.push(announcement.value.id)
  localStorage.setItem('dismissedAnnouncements', JSON.stringify(dismissed))
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-overlay" @click.self="dismiss">
      <div class="modal-card">
        <div class="modal-header">
          <span>📢 {{ announcement?.title }}</span>
          <span class="modal-close" @click="dismiss">✕</span>
        </div>
        <div class="modal-body">{{ announcement?.content }}</div>
        <div class="modal-footer">
          <button @click="dismiss">我知道了</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.modal-card {
  background: var(--bg-card);
  border: 1px solid rgba(232, 168, 56, 0.2);
  border-radius: 14px;
  max-width: 420px;
  width: 100%;
  overflow: hidden;
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 20px;
  font-size: 1rem;
  font-weight: 600;
  color: var(--amber);
  border-bottom: 1px solid var(--border-subtle);
  font-family: Cinzel, serif;
}
.modal-close {
  cursor: pointer;
  color: var(--text-muted);
  font-size: 1.1rem;
}
.modal-body {
  padding: 20px;
  font-size: 0.9rem;
  line-height: 1.7;
  color: var(--text-primary);
  white-space: pre-wrap;
}
.modal-footer {
  padding: 0 20px 18px;
}
.modal-footer button {
  width: 100%;
  padding: 10px;
  border-radius: 8px;
  background: var(--amber);
  border: none;
  color: var(--on-amber);
  font-weight: 600;
  font-size: 0.9rem;
  cursor: pointer;
  font-family: inherit;
}
</style>
