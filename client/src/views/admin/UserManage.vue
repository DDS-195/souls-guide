<script setup lang="ts">
// 用户管理页（/admin/users，auth+admin）
// 数据源：GET /admin/users（分页，返回 id/username/avatar/role/apply_status/status/created_at）
// 头像/用户名可点击跳转个人主页；封禁/解封（admin 行不可操作，后端 400「不能封禁管理员」）
// 删除用户：DELETE /admin/users/:id（硬删除，admin 行不可操作；确认弹窗二次确认后执行）
import { ref, onMounted } from 'vue'
import { adminApi } from '../../api'
import { toast } from '../../utils/toast'
import AppPagination from '../../components/AppPagination.vue'
import AppEmpty from '../../components/AppEmpty.vue'
import AppModal from '../../components/AppModal.vue'
import UserAvatar from '../../components/UserAvatar.vue'
import { usePagination } from '../../composables/usePagination'

const list = ref<any[]>([])
const loading = ref(true)
const error = ref('')
const { page, total, pageCount, pageSize, go } = usePagination(10)

// 删除用户：确认弹窗状态
const delOpen = ref(false)
const delTarget = ref<any>(null)
const delDeleting = ref(false)

const ROLE_LABEL: Record<string, string> = { admin: '管理员', creator: '创作者', user: '普通用户' }
const ROLE_CLS: Record<string, string> = { admin: 'role-admin', creator: 'role-creator', user: 'role-user' }

async function load() {
  loading.value = true
  error.value = ''
  try {
    const r: any = await adminApi.getUsers({ page: page.value, pageSize })
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

async function toggleBan(u: any) {
  try {
    await adminApi.toggleBan(u.id)
    toast(u.status === 1 ? `已封禁 ${u.username}` : `已解封 ${u.username}`, 'success')
    load() // 重新拉取刷新状态
  } catch (e: any) {
    toast(e?.response?.data?.message || '操作失败，请重试', 'error')
  }
}

// 删除用户：打开确认弹窗
function openDel(u: any) {
  delTarget.value = u
  delOpen.value = true
}

// 确认删除：DELETE /admin/users/:id，成功后在列表移除并回退页（同 Pending 的 removeAndBack 模式）
async function confirmDel() {
  if (!delTarget.value || delDeleting.value) return
  delDeleting.value = true
  try {
    const r: any = await adminApi.deleteUser(delTarget.value.id)
    const d = r?.data || {}
    toast(`已删除用户 ${delTarget.value.username}${d.post_count ? `（含 ${d.post_count} 篇文章）` : ''}`, 'success')
    delOpen.value = false
    const idx = list.value.findIndex((x) => x.id === delTarget.value.id)
    if (idx > -1) {
      list.value.splice(idx, 1)
      total.value -= 1
      if (!list.value.length && page.value > 1) {
        page.value -= 1
        load() // 空页回退
      }
    }
  } catch (e: any) {
    toast(e?.response?.data?.message || '删除失败，请重试', 'error')
  } finally {
    delDeleting.value = false
  }
}
</script>

<template>
  <div style="max-width: 900px; margin: 0 auto; padding: 20px 16px 40px; color: var(--text-primary)">
    <!-- 头部 -->
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px">
      <div style="display: flex; align-items: center; gap: 10px">
        <h2 style="font-family: Cinzel, serif; color: var(--amber)">用户管理</h2>
        <span v-if="!loading" class="badge">{{ total }} 人</span>
      </div>
      <button class="refresh-btn" @click="load">↻ 刷新</button>
    </div>

    <!-- 加载/错误/空态（AppEmpty 统一三件套） -->
    <AppEmpty :loading="loading" :error="error" empty-text="暂无用户" icon="👥" @retry="load" />

    <!-- 用户列表 -->
    <template v-if="!loading && !error && list.length">
      <div v-for="u in list" :key="u.id" class="user-card">
        <!-- 头像：点击跳转个人主页（UserAvatar 统一头像+兜底） -->
        <router-link :to="`/user/${u.id}`" class="avatar-link">
          <UserAvatar :src="u.avatar" :name="u.username || '?'" :size="42" />
        </router-link>
        <div style="flex: 1; min-width: 0">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
            <router-link :to="`/user/${u.id}`" class="user-name">{{ u.username }}</router-link>
            <span class="role-tag" :class="ROLE_CLS[u.role]">{{ ROLE_LABEL[u.role] || u.role }}</span>
            <span v-if="u.status === 0" class="ban-tag">已封禁</span>
            <span style="font-size: 0.72rem; color: var(--text-muted); margin-left: auto"
              >注册于 {{ u.created_at?.slice(0, 10) }}</span
            >
          </div>
        </div>
        <button
          v-if="u.role !== 'admin'"
          class="ban-btn"
          :class="u.status === 1 ? 'do-ban' : 'do-unban'"
          @click="toggleBan(u)"
        >
          {{ u.status === 1 ? '封禁' : '解封' }}
        </button>
        <span v-else style="font-size: 0.72rem; color: var(--text-muted); flex-shrink: 0">管理员不可封禁</span>
        <button v-if="u.role !== 'admin'" class="ban-btn do-del" @click="openDel(u)">删除</button>
      </div>

      <!-- 分页（AppPagination 统一控件） -->
      <AppPagination :page="page" :page-count="pageCount" @change="goPage" />
    </template>

    <!-- 删除确认弹窗（AppModal 统一弹窗）：红色警告 + 二次确认 -->
    <AppModal v-if="delOpen" title="删除用户" @close="delOpen = false">
      <div style="font-size: 0.85rem; margin-bottom: 8px">
        确认删除用户「<span style="font-weight: 700; color: var(--text-primary)">{{ delTarget?.username }}</span
        >」？
      </div>
      <div class="del-warn">⚠ 将永久删除该用户及其全部内容（文章/评论/收藏/点赞/关注等），此操作不可恢复。</div>
      <div style="display: flex; gap: 8px; margin-top: 14px">
        <button class="del-btn" :disabled="delDeleting" @click="delOpen = false">取消</button>
        <button class="del-btn primary" :disabled="delDeleting" @click="confirmDel">
          {{ delDeleting ? '删除中...' : '确认删除' }}
        </button>
      </div>
    </AppModal>
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

.user-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
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

.role-tag {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.65rem;
  font-weight: 600;
}
.role-admin {
  background: var(--amber-glow);
  color: var(--amber);
}
.role-creator {
  background: rgba(59, 157, 181, 0.12);
  color: var(--cyan);
}
.role-user {
  background: var(--border-subtle);
  color: var(--text-muted);
}
.ban-tag {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.65rem;
  font-weight: 600;
  background: rgba(196, 75, 75, 0.12);
  color: var(--red);
}

.ban-btn {
  flex-shrink: 0;
  padding: 5px 14px;
  border: none;
  border-radius: 6px;
  font-size: 0.78rem;
  cursor: pointer;
  font-family: inherit;
  transition: opacity var(--transition-fast);
}
.ban-btn:hover {
  opacity: 0.85;
}
.ban-btn.do-ban {
  background: var(--red);
  color: #fff;
}
.ban-btn.do-unban {
  background: var(--green);
  color: #fff;
}
.ban-btn.do-del {
  background: transparent;
  color: var(--red);
  border: 1px solid var(--red);
}

/* 删除确认弹窗内容 */
.del-warn {
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 0.78rem;
  background: rgba(196, 75, 75, 0.12);
  color: var(--red);
}
.del-btn {
  flex: 1;
  padding: 7px 0;
  border-radius: 6px;
  font-size: 0.8rem;
  cursor: pointer;
  background: var(--bg-hover);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-family: inherit;
  transition: all var(--transition-fast);
}
.del-btn:hover {
  color: var(--text-primary);
}
.del-btn.primary {
  background: var(--red);
  border-color: var(--red);
  color: #fff;
  font-weight: 600;
}
.del-btn.primary:hover {
  opacity: 0.85;
  color: #fff;
}
.del-btn.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
