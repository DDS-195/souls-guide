<script setup lang="ts">
// 用户管理页（/admin/users，auth+admin）
// 数据源：GET /admin/users（分页，返回 id/username/avatar/role/apply_status/status/created_at）
// 头像/用户名可点击跳转个人主页；封禁/解封（admin 行不可操作，后端 400「不能封禁管理员」）
// 删除用户：DELETE /admin/users/:id（硬删除，admin 行不可操作；确认弹窗二次确认后执行）
import { ref, onMounted, computed, onBeforeUnmount } from 'vue'
import { adminApi } from '../../api'
import { toast } from '../../utils/toast'
import AppPagination from '../../components/AppPagination.vue'
import AppEmpty from '../../components/AppEmpty.vue'
import AppModal from '../../components/AppModal.vue'
import UserAvatar from '../../components/UserAvatar.vue'
import { usePagination } from '../../composables/usePagination'
import { useLatestRequest } from '../../composables/useLatestRequest'
import { errorMessage } from '../../utils/errors'
import type { User } from '../../types/api'

const list = ref<User[]>([])
const loading = ref(true)
const error = ref('')
const { page, total, pageCount, pageSize, go } = usePagination(10)
const { next, isLatest } = useLatestRequest()
const actionUserId = ref<number | null>(null)
const keyword = ref(''), role = ref(''), status = ref('')
const filters = ref({ keyword: '', role: '', status: '' })
const banTarget = ref<User | null>(null)
const reason = ref(''), confirmName = ref(''), formError = ref('')
const moreId = ref<number | null>(null)
function closeMoreOnBlur(event: FocusEvent) {
  if (event.currentTarget instanceof HTMLElement && !event.currentTarget.contains(event.relatedTarget as Node | null)) moreId.value = null
}
const impact = ref<Awaited<ReturnType<typeof adminApi.previewUserDeletion>>['data'] | null>(null)
function search() { if (locked.value) return; filters.value = { keyword: keyword.value.trim(), role: role.value, status: status.value }; page.value = 1; load() }

// 删除用户：确认弹窗状态
const delOpen = ref(false)
const delTarget = ref<User | null>(null)
const delDeleting = ref(false)
const locked = computed(() => loading.value || actionUserId.value !== null || delOpen.value || !!banTarget.value)
onBeforeUnmount(() => next())

const ROLE_LABEL: Record<string, string> = { admin: '管理员', creator: '创作者', user: '普通用户' }
const ROLE_CLS: Record<string, string> = { admin: 'role-admin', creator: 'role-creator', user: 'role-user' }

async function load() {
  const sequence = next()
  loading.value = true
  error.value = ''
  try {
    const r = await adminApi.getUsers({ page: page.value, pageSize, keyword: filters.value.keyword || undefined, role: filters.value.role || undefined, status: filters.value.status || undefined })
    if (!isLatest(sequence)) return
    list.value = r.data.list || []
    total.value = r.data.total || 0
    if (page.value > pageCount.value) { page.value = pageCount.value; return load() }
  } catch (requestError: unknown) {
    if (!isLatest(sequence)) return
    error.value = errorMessage(requestError, '加载失败，请重试')
  } finally {
    if (isLatest(sequence)) loading.value = false
  }
}

onMounted(load)

function goPage(p: number) {
  if (locked.value) return
  if (go(p)) load()
}

async function toggleBan(u: User) {
  if (actionUserId.value !== null) return
  actionUserId.value = u.id
  try {
    if (!reason.value.trim()) { formError.value = '请填写操作原因'; return }
    const r = await adminApi.toggleBan(u.id, { status: u.status === 1 ? 0 : 1, version: u.management_version!, reason: reason.value.trim() })
    toast(r.data.status === 0 ? '已封禁，原登录凭证已作废' : '已解封，请用户重新登录', 'success')
    banTarget.value = null
    await load() // 重新拉取刷新状态
  } catch (error: unknown) {
    formError.value = errorMessage(error, '操作失败，请刷新后重新确认')
  } finally {
    actionUserId.value = null
  }
}

// 删除用户：打开确认弹窗
async function openDel(u: User) {
  if (actionUserId.value !== null) return
  delTarget.value = u
  delOpen.value = true
  reason.value = ''; confirmName.value = ''; formError.value = ''; impact.value = null
  delDeleting.value = true
  try { impact.value = (await adminApi.previewUserDeletion(u.id)).data }
  catch(e) { formError.value = errorMessage(e, '预览失败，请关闭后重试') }
  finally { delDeleting.value = false }
}

function closeDel() {
  if (delDeleting.value) return
  delOpen.value = false
  delTarget.value = null
}

// 确认删除：DELETE /admin/users/:id，成功后在列表移除并回退页（同 Pending 的 removeAndBack 模式）
async function confirmDel() {
  if (!delTarget.value || delDeleting.value) return
  const target = delTarget.value
  if (!impact.value || confirmName.value !== impact.value.username || !reason.value.trim()) { formError.value = '请输入完整用户名和操作原因'; return }
  delDeleting.value = true
  try {
    const r = await adminApi.deleteUser(target.id, { username: confirmName.value, reason: reason.value.trim(), fingerprint: impact.value.fingerprint })
    const d = r.data
    toast(`已删除用户 ${target.username}${d.post_count ? `（含 ${d.post_count} 篇文章）` : ''}`, 'success')
    delOpen.value = false
    delTarget.value = null
    await load()
  } catch (error: unknown) {
    formError.value = errorMessage(error, '删除失败，请重新预览')
  } finally {
    delDeleting.value = false
  }
}
</script>

<template>
  <div class="users-page">
    <!-- 头部 -->
    <div class="page-heading">
      <div style="display: flex; align-items: center; gap: 10px">
        <h2>用户管理</h2>
        <span v-if="!loading" class="badge">{{ total }} 人</span>
      </div>
      <button class="refresh-btn" :disabled="locked" @click="load">刷新</button>
    </div>

    <!-- 加载/错误/空态（AppEmpty 统一三件套） -->
    <form class="filters" @submit.prevent="search">
      <input v-model="keyword" maxlength="100" placeholder="用户名、昵称或完整 ID" aria-label="搜索用户" />
      <select v-model="role" aria-label="角色"><option value="">全部角色</option><option value="user">普通用户</option><option value="creator">创作者</option><option value="admin">管理员</option></select>
      <select v-model="status" aria-label="账号状态"><option value="">全部状态</option><option value="1">正常</option><option value="0">已封禁</option></select>
      <button class="refresh-btn" :disabled="loading || actionUserId !== null || delOpen || !!banTarget">查询</button>
    </form>
    <AppEmpty
      v-if="loading || error || !list.length"
      :loading="loading"
      :error="error"
      empty-text="暂无用户"
      icon="👥"
      @retry="load"
    />

    <!-- 用户列表 -->
    <div v-if="!loading && !error && list.length" class="user-list">
      <div v-for="u in list" :key="u.id" class="user-card">
        <!-- 头像：点击跳转个人主页（UserAvatar 统一头像+兜底） -->
        <router-link :to="`/user/${u.id}`" class="avatar-link">
          <UserAvatar :src="u.avatar" :name="u.username || '?'" :size="42" />
        </router-link>
        <div class="user-info">
          <div class="user-title">
            <router-link :to="`/user/${u.id}`" class="user-name" :title="u.nickname || u.username">{{ u.nickname || u.username }}</router-link>
            <span class="role-tag" :class="ROLE_CLS[u.role]">{{ ROLE_LABEL[u.role] || u.role }}</span>
          </div>
          <p class="identity" :title="'@' + u.username">@{{ u.username }} · ID {{ u.id }}</p>
          <div class="user-meta"><span :class="{ 'is-banned': u.status === 0 }">{{ u.status === 0 ? '已封禁' : '正常' }}</span><span>注册于 {{ u.created_at ? new Date(u.created_at).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '未知' }}</span></div>
        </div>
        <div class="row-actions" @keydown.esc="moreId = null" @focusout="closeMoreOnBlur">
        <button
          v-if="u.role !== 'admin'"
          class="ban-btn"
          :class="u.status === 1 ? 'do-ban' : 'do-unban'"
          :disabled="actionUserId !== null"
          @click="banTarget = { ...u }; reason = ''; formError = ''"
        >
          {{ actionUserId === u.id ? '处理中...' : u.status === 1 ? '封禁' : '解封' }}
        </button>
        <span v-else class="protected-label">受保护账号</span>
        <button
          v-if="u.role !== 'admin'"
          class="ban-btn more-btn"
          :aria-expanded="moreId === u.id"
          :disabled="actionUserId !== null"
          @click="moreId = moreId === u.id ? null : u.id"
        >
          更多
        </button>
        <div v-if="moreId === u.id && u.role !== 'admin'" class="more-panel"><button class="ban-btn do-del" :disabled="actionUserId !== null || delDeleting" @click="openDel(u); moreId = null">永久删除</button></div>
        </div>
      </div>

      <!-- 分页（AppPagination 统一控件） -->
      <AppPagination :page="page" :page-count="pageCount" @change="goPage" />
    </div>

    <!-- 删除确认弹窗（AppModal 统一弹窗）：红色警告 + 二次确认 -->
    <AppModal :open="Boolean(delOpen)" title="删除用户" @close="closeDel"><template v-if="delOpen">
      <div style="font-size: 0.85rem; margin-bottom: 8px">
        确认删除用户「<span style="font-weight: 700; color: var(--text-primary)">{{ delTarget?.username }}</span
        >」？
      </div>
      <div v-if="impact" class="del-warn">
        删除 {{ impact.post_count }} 篇文章及文章下 {{ impact.removed_comment_count }} 条评论（含他人评论）。其他文章上的 {{ impact.retained_comment_count }} 条本人评论保留已删除占位及他人回复。{{ impact.asset_count }} 项上传资产进入清理流程。
        <p>账号与上述内容不可恢复；历史统计及管理审计按现有规则保留。</p>
        <p v-if="impact.announcement_count">该用户发布过公告，不允许删除。</p>
      </div>
      <label>输入完整用户名确认<input v-model="confirmName" :disabled="delDeleting" autocomplete="off" /></label>
      <label>操作原因<textarea v-model="reason" :disabled="delDeleting" maxlength="300" rows="3" /></label>
      <p v-if="formError" class="del-warn" role="alert">{{ formError }}</p>
      <div style="display: flex; gap: 8px; margin-top: 14px">
        <button class="del-btn" :disabled="delDeleting" @click="closeDel">取消</button>
        <button class="del-btn primary" :disabled="delDeleting || !impact || !!impact.announcement_count || confirmName !== impact.username || !reason.trim()" @click="confirmDel">
          {{ delDeleting ? '删除中...' : '确认删除' }}
        </button>
      </div>
    </template></AppModal>
    <AppModal :open="Boolean(banTarget)" :title="banTarget?.status === 1 ? '封禁用户' : '解封用户'" @close="actionUserId === null && (banTarget = null)"><template v-if="banTarget">
      <p>{{ banTarget.username }} · ID {{ banTarget.id }}</p>
      <p>封禁限制登录与操作，不下架历史文章；原登录凭证将永久作废，解封后需重新登录。</p>
      <label>操作原因<textarea v-model="reason" :disabled="actionUserId !== null" maxlength="300" rows="3" /></label>
      <p v-if="formError" class="del-warn" role="alert">{{ formError }}</p>
      <div class="modal-actions"><button class="del-btn" :disabled="actionUserId !== null" @click="banTarget = null">取消</button><button class="del-btn primary" :disabled="actionUserId !== null || !reason.trim()" @click="toggleBan(banTarget)">确认</button></div>
    </template></AppModal>
  </div>
</template>

<style scoped>
.users-page { width:100%; max-width:592px; box-sizing:border-box; margin:auto; padding:24px 16px 40px; color:var(--text-primary); }
.user-list { width:100%; max-width:560px; margin-inline:auto; }
.page-heading { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:24px; }
.page-heading h2 { margin:0; color:var(--amber); }
.filters { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:20px; }
input, select, textarea { padding:9px; background:var(--bg-card); color:var(--text-primary); border:1px solid var(--border-subtle); border-radius:6px; font:inherit; font-size:.85rem; box-sizing:border-box; }
.filters input { flex:1; min-width:170px; }
label { display:block; margin-top:14px; }
label input, label textarea { display:block; width:100%; margin-top:8px; }
.identity { margin:0 0 6px; font-size:.8rem; color:var(--text-secondary); overflow-wrap:anywhere; }
.modal-actions { display:flex; gap:10px; margin-top:18px; }
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
.refresh-btn:disabled,
.ban-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.user-card {
  display: grid;
  grid-template-columns: 42px minmax(0,1fr) 112px;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
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
  background: transparent;
  color: var(--text-secondary);
}
.ban-btn.do-unban {
  background: transparent;
  color: var(--green);
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
.filters { display:grid; grid-template-columns:minmax(150px,1fr) 120px 120px 70px; padding:14px; background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:9px; gap:10px; margin-bottom:18px; }
.filters input { min-width:0; }
.filters input, .filters select, .filters button { min-height:38px; width:100%; }
.filters button { color:var(--on-amber); background:var(--amber); border-color:var(--amber); }
.user-info { min-width:0; }
.user-title { display:flex; align-items:center; gap:8px; }
.user-name { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.role-tag { flex-shrink:0; white-space:nowrap; font-weight:400; }
.identity { margin:5px 0 3px; font-size:.75rem; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.user-meta { display:flex; flex-wrap:wrap; gap:6px 12px; color:var(--text-muted); font-size:.72rem; line-height:1.6; }
.is-banned { color:var(--red); }
.row-actions { position:relative; display:flex; justify-content:flex-end; align-items:center; gap:8px; }
.row-actions .ban-btn { width:52px; min-height:34px; padding:6px 0; border:1px solid var(--border-subtle); background:transparent; border-radius:6px; }
.row-actions .more-btn { color:var(--text-secondary); }
.protected-label { text-align:center; width:112px; color:var(--text-muted); font-size:.75rem; }
.more-panel { position:absolute; right:0; top:calc(100% + 6px); z-index:10; padding:5px; border:1px solid var(--border-subtle); border-radius:7px; background:var(--bg-card); box-shadow:0 6px 20px #0003; }
.more-panel .ban-btn { width:100px; border:none; }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline:2px solid var(--amber); outline-offset:2px; }
@media(max-width:600px) {
  .filters { grid-template-columns:minmax(0,1fr) minmax(0,1fr) 64px; }
  .filters input { grid-column:1 / -1; }
  .user-card { gap:8px; padding:10px; grid-template-columns:42px minmax(0,1fr) 94px; }
  .row-actions { gap:6px; }
  .row-actions .ban-btn { width:44px; min-height:36px; }
  .protected-label { width:94px; }
  .user-title { flex-wrap:wrap; gap:4px 6px; }
  .user-name { max-width:100%; }
  .more-panel .ban-btn { width:100px; }
}
</style>
