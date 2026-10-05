<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { adminApi } from '../../api'
import AppEmpty from '../../components/AppEmpty.vue'
import AppModal from '../../components/AppModal.vue'
import AppPagination from '../../components/AppPagination.vue'
import { usePagination } from '../../composables/usePagination'
import type { Announcement, AnnouncementStatus } from '../../types/api'
import { errorMessage } from '../../utils/errors'
import { toast } from '../../utils/toast'

type EditableForm = { title: string; content: string }

const list = ref<Announcement[]>([])
const loading = ref(true)
const loadError = ref('')
const statusFilter = ref<'all' | 'draft' | 'published' | 'archived'>('all')
const { page, total, pageCount, pageSize, go } = usePagination(10)

const createOpen = ref(false)
const createSaving = ref(false)
const createForm = ref<EditableForm>({ title: '', content: '' })
const editTarget = ref<Announcement | null>(null)
const editSaving = ref(false)
const editForm = ref<EditableForm>({ title: '', content: '' })
const busyIds = ref<Set<number>>(new Set())
let loadSequence = 0

const statusMap: Record<AnnouncementStatus, string> = {
  draft: '草稿',
  published: '当前生效',
  archived: '已归档',
  deleted: '已删除',
}

async function load() {
  const sequence = ++loadSequence
  loading.value = true
  loadError.value = ''
  try {
    const status = statusFilter.value === 'all' ? undefined : statusFilter.value
    const response = await adminApi.getAnnouncements({ page: page.value, pageSize, status })
    if (sequence !== loadSequence) return
    list.value = response.data.list || []
    total.value = response.data.total || 0
  } catch (requestError: unknown) {
    if (sequence === loadSequence) loadError.value = errorMessage(requestError, '加载失败，请重试')
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

onMounted(load)

function changeFilter() {
  page.value = 1
  load()
}

function goPage(nextPage: number) {
  if (go(nextPage)) load()
}

function normalized(form: EditableForm) {
  const title = form.title.trim()
  const content = form.content.trim()
  if (!title || !content) {
    toast('标题和内容不能为空', 'error')
    return null
  }
  return { title, content }
}

function openCreate() {
  createForm.value = { title: '', content: '' }
  createOpen.value = true
}

async function saveCreate() {
  const payload = normalized(createForm.value)
  if (!payload || createSaving.value) return
  createSaving.value = true
  try {
    await adminApi.createAnnouncement(payload)
    createOpen.value = false
    statusFilter.value = 'draft'
    page.value = 1
    toast('草稿已创建', 'success')
    await load()
  } catch (requestError: unknown) {
    toast(errorMessage(requestError, '创建失败'), 'error')
  } finally {
    createSaving.value = false
  }
}

function openEdit(announcement: Announcement) {
  if (announcement.status !== 'draft') return
  editTarget.value = announcement
  editForm.value = { title: announcement.title, content: announcement.content }
}

async function saveEdit() {
  const target = editTarget.value
  const payload = normalized(editForm.value)
  if (!target || !payload || editSaving.value) return
  editSaving.value = true
  try {
    await adminApi.updateAnnouncement(target.id, { ...payload, version: target.version })
    editTarget.value = null
    toast('草稿已保存', 'success')
    await load()
  } catch (requestError: unknown) {
    toast(errorMessage(requestError, '保存失败'), 'error')
    await load()
  } finally {
    editSaving.value = false
  }
}

function setBusy(id: number, busy: boolean) {
  const next = new Set(busyIds.value)
  if (busy) next.add(id)
  else next.delete(id)
  busyIds.value = next
}

async function runAction(id: number, action: () => Promise<void>) {
  if (busyIds.value.has(id)) return
  setBusy(id, true)
  try {
    await action()
  } finally {
    setBusy(id, false)
  }
}

function publish(announcement: Announcement) {
  if (!window.confirm(`发布《${announcement.title}》？当前生效公告会自动归档，发布后的正文不可原地修改。`)) return
  runAction(announcement.id, async () => {
    try {
      await adminApi.publishAnnouncement(announcement.id)
      toast('公告已发布', 'success')
      await load()
    } catch (requestError: unknown) {
      toast(errorMessage(requestError, '发布失败'), 'error')
    }
  })
}

function archive(announcement: Announcement) {
  if (!window.confirm(`归档《${announcement.title}》？归档后全站将不再展示该公告。`)) return
  runAction(announcement.id, async () => {
    try {
      await adminApi.archiveAnnouncement(announcement.id)
      toast('公告已归档', 'success')
      await load()
    } catch (requestError: unknown) {
      toast(errorMessage(requestError, '归档失败'), 'error')
    }
  })
}

function cloneAsDraft(announcement: Announcement) {
  runAction(announcement.id, async () => {
    try {
      await adminApi.cloneAnnouncement(announcement.id)
      statusFilter.value = 'draft'
      page.value = 1
      toast('已复制为新草稿，可安全修改后重新发布', 'success')
      await load()
    } catch (requestError: unknown) {
      toast(errorMessage(requestError, '复制失败'), 'error')
    }
  })
}

function removeDraft(announcement: Announcement) {
  if (!window.confirm(`删除草稿《${announcement.title}》？该操作会保留审计快照，但草稿将不再显示。`)) return
  runAction(announcement.id, async () => {
    try {
      await adminApi.deleteAnnouncement(announcement.id)
      toast('草稿已删除', 'success')
      if (list.value.length === 1 && page.value > 1) page.value -= 1
      await load()
    } catch (requestError: unknown) {
      toast(errorMessage(requestError, '删除失败'), 'error')
    }
  })
}
</script>

<template>
  <main class="announcement-page">
    <header class="page-header">
      <div>
        <h2>公告管理</h2>
        <p>草稿可编辑；发布版本冻结。修订历史公告时，请复制为新草稿。</p>
      </div>
      <button class="btn primary" @click="openCreate">新增草稿</button>
    </header>

    <section class="policy-note">
      <strong>发布规则：</strong>全站同时只展示一条公告。发布新草稿会自动归档旧公告，归档不会删除历史内容。
    </section>

    <div class="toolbar">
      <label for="announcement-status">状态</label>
      <select id="announcement-status" v-model="statusFilter" @change="changeFilter">
        <option value="all">全部</option>
        <option value="draft">草稿</option>
        <option value="published">当前生效</option>
        <option value="archived">已归档</option>
      </select>
      <span>{{ total }} 条</span>
      <button class="btn quiet" :disabled="loading" @click="load">刷新</button>
    </div>

    <AppEmpty
      v-if="loading || loadError || !list.length"
      :loading="loading"
      :error="loadError"
      empty-text="暂无公告"
      icon="📢"
      @retry="load"
    />

    <section v-if="!loading && !loadError && list.length" class="announcement-list">
      <article v-for="announcement in list" :key="announcement.id" class="announcement-card">
        <div class="card-main">
          <div class="title-row">
            <h3>{{ announcement.title }}</h3>
            <span class="status-tag" :class="announcement.status">{{ statusMap[announcement.status] }}</span>
            <span class="version">v{{ announcement.version }}</span>
          </div>
          <p class="content-preview">{{ announcement.content }}</p>
          <div class="metadata">
            <span>创建者：{{ announcement.author_username || `#${announcement.author_id}` }}</span>
            <span>创建：{{ announcement.created_at?.replace('T', ' ').slice(0, 16) }}</span>
            <span v-if="announcement.published_at">发布：{{ announcement.published_at.replace('T', ' ').slice(0, 16) }}</span>
            <span v-if="announcement.source_id">源公告：#{{ announcement.source_id }}</span>
          </div>
        </div>
        <div class="actions">
          <template v-if="announcement.status === 'draft'">
            <button class="btn quiet" :disabled="busyIds.has(announcement.id)" @click="openEdit(announcement)">编辑</button>
            <button class="btn primary" :disabled="busyIds.has(announcement.id)" @click="publish(announcement)">发布</button>
            <button class="btn danger" :disabled="busyIds.has(announcement.id)" @click="removeDraft(announcement)">删除</button>
          </template>
          <template v-else>
            <button class="btn quiet" :disabled="busyIds.has(announcement.id)" @click="cloneAsDraft(announcement)">复制为草稿</button>
            <button
              v-if="announcement.status === 'published'"
              class="btn danger"
              :disabled="busyIds.has(announcement.id)"
              @click="archive(announcement)"
            >归档</button>
          </template>
        </div>
      </article>
      <AppPagination :page="page" :page-count="pageCount" @change="goPage" />
    </section>

    <AppModal :open="Boolean(createOpen)" title="新增公告草稿" @close="createOpen = false"><template v-if="createOpen">
      <label class="field-label" for="create-announcement-title">标题</label>
      <input id="create-announcement-title" v-model="createForm.title" maxlength="200" class="field" />
      <label class="field-label" for="create-announcement-content">正文</label>
      <textarea id="create-announcement-content" v-model="createForm.content" rows="7" class="field"></textarea>
      <div class="modal-actions">
        <button class="btn quiet" :disabled="createSaving" @click="createOpen = false">取消</button>
        <button class="btn primary" :disabled="createSaving" @click="saveCreate">{{ createSaving ? '保存中…' : '保存草稿' }}</button>
      </div>
    </template></AppModal>

    <AppModal :open="Boolean(editTarget)" title="编辑公告草稿" @close="editTarget = null"><template v-if="editTarget">
      <label class="field-label" for="edit-announcement-title">标题</label>
      <input id="edit-announcement-title" v-model="editForm.title" maxlength="200" class="field" />
      <label class="field-label" for="edit-announcement-content">正文</label>
      <textarea id="edit-announcement-content" v-model="editForm.content" rows="7" class="field"></textarea>
      <div class="modal-actions">
        <button class="btn quiet" :disabled="editSaving" @click="editTarget = null">取消</button>
        <button class="btn primary" :disabled="editSaving" @click="saveEdit">{{ editSaving ? '保存中…' : '保存修改' }}</button>
      </div>
    </template></AppModal>
  </main>
</template>

<style scoped>
.announcement-page { max-width: 980px; margin: 0 auto; padding: 24px 18px 48px; color: var(--text-primary); }
.page-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; margin-bottom: 18px; }
.page-header h2 { margin: 0; color: var(--amber); font-family: Cinzel, serif; }
.page-header p { margin: 6px 0 0; color: var(--text-muted); font-size: .8rem; }
.policy-note { padding: 12px 14px; margin-bottom: 14px; border: 1px solid rgba(232,168,56,.25); border-radius: 8px; background: var(--amber-glow); color: var(--text-secondary); font-size: .8rem; }
.toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; color: var(--text-muted); font-size: .78rem; }
.toolbar select { padding: 7px 28px 7px 10px; color: var(--text-primary); background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 6px; }
.toolbar span { margin-left: auto; }
.announcement-list { display: grid; gap: 10px; }
.announcement-card { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; padding: 16px; background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 10px; }
.card-main { flex: 1; min-width: 0; }
.title-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.title-row h3 { margin: 0; font-size: .96rem; }
.status-tag, .version { padding: 2px 8px; border-radius: 999px; font-size: .66rem; }
.status-tag.draft { color: var(--text-secondary); background: var(--bg-hover); }
.status-tag.published { color: var(--green); background: rgba(80,180,120,.12); }
.status-tag.archived { color: var(--text-muted); background: var(--bg-hover); }
.version { color: var(--amber); border: 1px solid rgba(232,168,56,.25); }
.content-preview { display: -webkit-box; overflow: hidden; margin: 9px 0; color: var(--text-secondary); font-size: .82rem; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
.metadata { display: flex; flex-wrap: wrap; gap: 12px; color: var(--text-muted); font-size: .68rem; }
.actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; flex-shrink: 0; }
.btn { padding: 7px 14px; border: 1px solid transparent; border-radius: 7px; cursor: pointer; font: inherit; font-size: .78rem; transition: opacity var(--transition-fast); }
.btn:disabled { opacity: .45; cursor: not-allowed; }
.btn.primary { color: var(--on-amber); background: var(--amber); font-weight: 600; }
.btn.quiet { color: var(--text-secondary); background: var(--bg-card); border-color: var(--border-subtle); }
.btn.danger { color: var(--red); background: var(--bg-card); border-color: rgba(190,70,70,.3); }
.field-label { display: block; margin: 10px 0 5px; color: var(--text-secondary); font-size: .76rem; }
.field { width: 100%; box-sizing: border-box; padding: 9px 10px; color: var(--text-primary); background: var(--bg-sidebar); border: 1px solid var(--border-subtle); border-radius: 7px; font: inherit; resize: vertical; }
.field:focus { outline: none; border-color: var(--amber); }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
@media (max-width: 700px) {
  .page-header, .announcement-card { flex-direction: column; }
  .actions { width: 100%; justify-content: flex-start; }
}
</style>
