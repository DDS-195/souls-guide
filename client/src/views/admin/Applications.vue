<script setup lang="ts">
// 创作者申请审核页（/admin/applications，auth+admin）
// 数据源：GET /admin/applications（分页，返回 users.* 含 apply_reason/avatar）
// 管理员可点击申请人头像/用户名跳转个人主页核实资料后再 通过/驳回
import { ref, onMounted } from 'vue'
import { adminApi } from '../../api'
import { toast } from '../../utils/toast'
import AppPagination from '../../components/AppPagination.vue'
import AppEmpty from '../../components/AppEmpty.vue'
import UserAvatar from '../../components/UserAvatar.vue'
import { usePagination } from '../../composables/usePagination'

const list = ref<any[]>([])
const loading = ref(true)
const error = ref('')
const { page, total, pageCount, pageSize, go } = usePagination(10)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const r: any = await adminApi.getApplications({ page: page.value, pageSize })
    list.value = r.data.list || []
    total.value = r.data.total || 0
  } catch (e: any) {
    error.value = e?.response?.data?.message || '加载失败，请重试'
  } finally {
    loading.value = false
  }
}

onMounted(load)

function goPage(p: number) {
  if (go(p)) load()
}

async function approve(u: any) {
  try {
    await adminApi.approveApplication(u.id)
    toast(`已通过 ${u.username} 的创作者申请`, 'success')
    removeAndBack(u.id)
  } catch (e: any) {
    toast(e?.response?.data?.message || '操作失败，请重试', 'error')
  }
}

async function reject(u: any) {
  try {
    await adminApi.rejectApplication(u.id)
    toast(`已驳回 ${u.username} 的申请`, 'success')
    removeAndBack(u.id)
  } catch (e: any) {
    toast(e?.response?.data?.message || '操作失败，请重试', 'error')
  }
}

function removeAndBack(id: number) {
  list.value = list.value.filter((u: any) => u.id !== id)
  total.value = Math.max(0, total.value - 1)
  if (!list.value.length && page.value > 1) {
    page.value -= 1
    load()
  }
}
</script>

<template>
  <div style="max-width: 900px; margin: 0 auto; padding: 20px 16px 40px; color: var(--text-primary)">
    <!-- 头部 -->
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px">
      <div style="display: flex; align-items: center; gap: 10px">
        <h2 style="font-family: Cinzel, serif; color: var(--amber)">创作者申请</h2>
        <span v-if="!loading" class="badge">{{ total }} 条待审</span>
      </div>
      <button class="refresh-btn" @click="load">↻ 刷新</button>
    </div>

    <!-- 加载/错误/空态（AppEmpty 统一三件套） -->
    <AppEmpty :loading="loading" :error="error" empty-text="暂无待审批申请" icon="🪶" @retry="load" />

    <!-- 申请列表 -->
    <template v-if="!loading && !error && list.length">
      <div v-for="u in list" :key="u.id" class="app-card">
        <!-- 头像：点击跳转个人主页核实资料（UserAvatar 统一头像+兜底） -->
        <router-link :to="`/user/${u.id}`" class="avatar-link">
          <UserAvatar :src="u.avatar" :name="u.nickname || u.username || '?'" :size="46" />
        </router-link>
        <div style="flex: 1; min-width: 0">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
            <router-link :to="`/user/${u.id}`" class="user-name">{{ u.nickname || u.username }}</router-link>
            <span style="font-size: 0.72rem; color: var(--text-muted)">@{{ u.username }}</span>
            <span style="font-size: 0.72rem; color: var(--text-muted)">🕐 {{ u.created_at?.slice(0, 10) }}</span>
          </div>
          <div class="reason-title">申请理由</div>
          <div class="reason-text">{{ u.apply_reason || '未填写理由' }}</div>
        </div>
        <div style="display: flex; gap: 8px; flex-shrink: 0">
          <button class="action-btn danger" @click="reject(u)">驳回</button>
          <button class="action-btn primary" @click="approve(u)">✓ 通过</button>
        </div>
      </div>

      <!-- 分页（AppPagination 统一控件） -->
      <AppPagination :page="page" :page-count="pageCount" @change="goPage" />
    </template>
  </div>
</template>

<style scoped>
.badge {
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 0.72rem;
  font-weight: 600;
  background: var(--amber-glow);
  color: var(--amber);
}
.refresh-btn {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 0.78rem;
  cursor: pointer;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-family: inherit;
  transition: all var(--transition-fast);
}
.refresh-btn:hover {
  color: var(--text-primary);
  border-color: var(--text-muted);
}

.app-card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 14px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  margin-bottom: 8px;
}
.avatar-link {
  flex-shrink: 0;
  text-decoration: none;
  display: inline-flex;
  transition: opacity var(--transition-fast);
}
.avatar-link:hover {
  opacity: 0.85;
}
.user-name {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
  text-decoration: none;
  transition: color var(--transition-fast);
}
.user-name:hover {
  color: var(--amber);
}
.reason-title {
  margin-top: 8px;
  font-size: 0.7rem;
  color: var(--text-muted);
  font-weight: 600;
}
.reason-text {
  margin-top: 2px;
  font-size: 0.85rem;
  color: var(--text-primary);
  line-height: 1.6;
  word-break: break-word;
}

.action-btn {
  padding: 6px 16px;
  border: none;
  border-radius: 6px;
  font-size: 0.8rem;
  cursor: pointer;
  font-family: inherit;
  transition: opacity var(--transition-fast);
}
.action-btn:hover {
  opacity: 0.85;
}
.action-btn.primary {
  background: var(--green);
  color: #fff;
  font-weight: 600;
}
.action-btn.danger {
  background: var(--red);
  color: #fff;
}
</style>
