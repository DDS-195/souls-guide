<script setup lang="ts">
import { ref, computed, watch, defineAsyncComponent, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { gameApi, postApi, mediaApi } from '../../api'
import VideoUploader from '../../components/VideoUploader.vue'
import { toast } from '../../utils/toast'
import { compressImage } from '../../utils/image'
import type { Game, PostPayload } from '../../types/api'
import { useUserStore } from '../../stores/user'
import { createRequestId } from '../../utils/requestId'
import { CATEGORIES, GUIDE_SECTIONS, emptyGuide, guideFrom, formatTime, parseChapters } from '../../utils/guide'
import { draftKey, readWritingDraft, storeWritingDraft, removeWritingDraft, type WritingDraft } from '../../utils/writingDraft'

// 写作页才加载编辑器。统一实例避免跨越宽度断点时销毁选区、输入法和进行中的上传。
const richReady = ref(false)
const richError = ref(false)
const RichTextEditor = defineAsyncComponent({
  loader: () => import('../../components/RichTextEditor.vue'),
  onError(_error, retry, fail, attempts) {
    if (attempts < 2) retry()
    else { richError.value = true; fail() }
  },
})

/**
 * 写攻略（D12/D13，D22 富文本版）：
 * 标题 → 游戏/分类/标签 → 主视频（分片断点续传）→ 封面（可选）→ 富文本正文（TinyMCE，PC）
 * 保存 body：{ title, content, game_id, category, status, tags[], video, cover }
 * 编辑回填通过受保护的 getManageDetail 按 ID 获取，并由后端校验作者/admin。
 * 手机和桌面复用可视化编辑器，移动端使用触屏工具栏，不直接编辑 HTML 标签。
 */
const router = useRouter()
const route = useRoute()
const savedId = ref(Number(route.params.id) || 0)
const contentVersion = ref(1)
const user = useUserStore()
const writerId = Number(user.userInfo?.id)
const writerSession = user.token
const storageKey = Number.isSafeInteger(writerId) && writerId > 0 ? draftKey(writerId, String(route.params.id || 'new')) : ''
const recoverable = ref<WritingDraft | null>(null)
const pendingCreate = ref<WritingDraft['pendingCreate']>(null)
const conflictMessage = ref('')
const localSaved = ref(false)
const storageFailed = ref(false)
const baseline = ref('')
let allowLeave = false
let draftTimer: ReturnType<typeof setTimeout> | undefined
const editorReady = ref(false)
const editorError = ref(false)
let alive = true
onUnmounted(() => { alive = false })
const games = ref<Game[]>([])
const form = ref({ title: '', content: '', game_id: 0, category: 'BOSS攻略', tags: '' })
const guide = ref(emptyGuide())
const chapterText = ref('')
function applyGuide(value?: import('../../types/api').GuideInfo | null) {
  guide.value = guideFrom(value)
  chapterText.value = guide.value.video_chapters.map(c => `${formatTime(c.seconds)} ${c.title}`).join('\n')
}
function insertTemplate() {
  if (form.value.content.trim() && !window.confirm('这会替换当前正文为分类模板，确定继续吗？')) return
  form.value.content = (GUIDE_SECTIONS[form.value.category] || []).map(title => `<h2>${title}</h2><p></p>`).join('')
}
const originalGameId = ref(0)
const gamesLoading = ref(true)
const gamesError = ref('')
async function loadGames() {
  gamesLoading.value = true
  gamesError.value = ''
  try {
    games.value = (await gameApi.getList(true)).data
    if (!route.params.id && !form.value.game_id) form.value.game_id = games.value.find((g) => g.status === 1)?.id || 0
  } catch {
    gamesError.value = '游戏列表加载失败，请重试'
  } finally {
    gamesLoading.value = false
  }
}
const videoUrl = ref<string | null>(null)
const coverUrl = ref<string | null>(null)
const coverAssetId = ref<number | null>(null)
const loading = ref(false)
const originalStatus = ref('')
const coverUploading = ref(false)
let coverSequence = 0
let pendingCoverUploads = 0
const videoUploading = ref(false)
const editorUploading = ref(false)
const coverInput = ref<HTMLInputElement | null>(null)
const uploadBusy = computed(() => coverUploading.value || videoUploading.value || editorUploading.value)
const snapshot = () => JSON.stringify({ form: form.value, video: videoUrl.value, cover: coverUrl.value, guide: guide.value, chapterText: chapterText.value })
const dirty = computed(() => !!baseline.value && (snapshot() !== baseline.value || !!pendingCreate.value))
function persistDraft() {
  clearTimeout(draftTimer)
  if (allowLeave || !editorReady.value || (!dirty.value && !(savedId.value && !route.params.id)) || !storageKey || user.token !== writerSession) return
  localSaved.value = storeWritingDraft(storageKey, {
    form: { ...form.value }, video: videoUrl.value, cover: coverUrl.value,
    savedId: savedId.value, version: contentVersion.value, originalGameId: originalGameId.value,
    pendingCreate: pendingCreate.value, savedAt: Date.now(),
    guide: guide.value, chapterText: chapterText.value,
  })
  storageFailed.value = !localSaved.value
}
watch([form, videoUrl, coverUrl, guide, chapterText], () => {
  if (!baseline.value) return
  localSaved.value = false
  clearTimeout(draftTimer)
  draftTimer = setTimeout(persistDraft, 600)
}, { deep: true, flush: 'sync' })
function restoreDraft() {
  const draft = recoverable.value
  if (!draft || loading.value) return
  form.value = { ...draft.form }
  videoUrl.value = draft.video
  coverUrl.value = draft.cover
  savedId.value = draft.savedId
  contentVersion.value = draft.version
  originalGameId.value = draft.originalGameId
  pendingCreate.value = draft.pendingCreate
  if (draft.guide) guide.value = guideFrom(draft.guide)
  if (draft.chapterText !== undefined) chapterText.value = draft.chapterText
  recoverable.value = null
  persistDraft()
  toast('已恢复本机内容；未保存的上传资源可能已过期，请检查图片和视频', 'info')
}
function discardDraft() { removeWritingDraft(storageKey); recoverable.value = null }
function confirmLeave() {
  if (allowLeave) return true
  persistDraft()
  return !(dirty.value || loading.value || uploadBusy.value) || window.confirm('当前内容尚未完成保存，或上传仍在处理。确定离开编辑页吗？')
}
onBeforeRouteLeave(confirmLeave)
onBeforeRouteUpdate(confirmLeave)
function beforeUnload(event: BeforeUnloadEvent) {
  persistDraft()
  if (dirty.value || loading.value || uploadBusy.value) { event.preventDefault(); event.returnValue = '' }
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onUnmounted(() => { persistDraft(); clearTimeout(draftTimer); window.removeEventListener('beforeunload', beforeUnload) })

function reloadEditorPage() { persistDraft(); window.location.reload() }

async function initEditor() {
  editorError.value = false
  await loadGames()
  if (!alive) return
  if (route.params.id) {
    try {
      const { data: item } = await postApi.getManageDetail(+route.params.id)
      if (!alive) return
      originalStatus.value = item.status
      contentVersion.value = item.content_version
      form.value.title = item.title
      form.value.content = item.content
      form.value.game_id = item.game_id
      originalGameId.value = item.game_id
      form.value.category = item.category
      const t = item.tags
      form.value.tags = Array.isArray(t) ? t.join(',') : t || ''
      videoUrl.value = item.media.find((media) => media.type === 'video')?.url || null
      coverUrl.value = item.cover || null
      applyGuide(item.guide_info)
      editorReady.value = true
    } catch {
      editorError.value = true
      toast('攻略加载失败', 'error')
    }
  } else editorReady.value = true
  if (editorReady.value) {
    baseline.value = snapshot()
    recoverable.value = storageKey ? readWritingDraft(storageKey) : null
  }
}
onMounted(initEditor)

async function reloadServerVersion() {
  if (loading.value || uploadBusy.value || !savedId.value || !window.confirm('重新载入会用服务器版本替换当前编辑区。确定继续吗？')) return
  loading.value = true
  try {
    const { data: item } = await postApi.getManageDetail(savedId.value)
    if (!alive) return
    form.value = { title: item.title, content: item.content, game_id: item.game_id, category: item.category, tags: item.tags.join(',') }
    videoUrl.value = item.media.find(m => m.type === 'video')?.url || null
    coverUrl.value = item.cover
    applyGuide(item.guide_info)
    contentVersion.value = item.content_version
    originalStatus.value = item.status
    originalGameId.value = item.game_id
    pendingCreate.value = null
    conflictMessage.value = ''
    baseline.value = snapshot()
    clearTimeout(draftTimer)
    removeWritingDraft(storageKey)
    localSaved.value = false
  } catch { toast('服务器版本加载失败，当前内容已保留', 'error') }
  finally { loading.value = false }
}

async function uploadCover(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !alive || loading.value || recoverable.value || user.token !== writerSession) return
  const sequence = ++coverSequence
  pendingCoverUploads++
  coverUploading.value = true
  const current = () => alive && user.token === writerSession && sequence === coverSequence
  try {
    // 图片压缩（10.1 契约）：封面 800px/0.85，Canvas→WebP，压缩失败则原图上传（后端 5MB 兜底）
    const compressed = await compressImage(file, { maxWidth: 800, quality: 0.85 })
    if (!current()) return
    const res = await mediaApi.uploadImage(compressed)
    if (!current()) {
      await discardCoverAsset(res.data.asset_id)
      return
    }
    const previousAssetId = coverAssetId.value
    coverUrl.value = res.data.url
    coverAssetId.value = res.data.asset_id
    if (previousAssetId && previousAssetId !== res.data.asset_id) {
      await discardCoverAsset(previousAssetId)
    }
    if (current()) toast('封面已设置', 'success')
  } catch {
    if (current()) toast('封面上传失败（≤5MB）', 'error')
  } finally {
    pendingCoverUploads--
    if (alive && user.token === writerSession) coverUploading.value = pendingCoverUploads > 0
  }
}

async function discardCoverAsset(assetId: number) {
  // 换账号后不使用新会话删除旧账号资源；未清理成功的临时资源由服务端过期任务回收。
  if (user.token === writerSession) await mediaApi.removeAsset(assetId).catch(() => {})
}

async function removeCover() {
  if (!alive || loading.value || recoverable.value || user.token !== writerSession) return
  ++coverSequence // 移除也属于最新选择，不能被尚未返回的上传重新填回。
  const temporaryAssetId = coverAssetId.value
  coverUrl.value = null
  coverAssetId.value = null
  if (temporaryAssetId) await discardCoverAsset(temporaryAssetId)
}

async function save(status: 'draft' | 'pending') {
  if (loading.value) return
  if (user.token !== writerSession) return toast('登录账号已变化，请重新打开编辑页', 'error')
  if (recoverable.value) return toast('请先选择恢复或忽略本机草稿', 'info')
  if (conflictMessage.value) return toast('请先处理版本冲突，当前编辑内容已保留', 'info')
  if (!editorReady.value) return toast('文章尚未加载成功，请重新打开编辑页', 'error')
  if (!richReady.value) return toast('正文编辑器尚未就绪，请稍候或重新加载页面', 'info')
  if (coverUploading.value) return toast('请等待图片上传完成', 'info')
  if (videoUploading.value || editorUploading.value) return toast('请等待视频处理或正文图片上传完成', 'info')
  const tags = form.value.tags.split(/[,，]/).map(t => t.trim()).filter(Boolean)
  if (tags.length > 20 || tags.some(t => Array.from(t).length > 30)) return toast('最多20个标签，每个不超过30字', 'error')
  const game = games.value.find((g) => g.id === form.value.game_id)
  if (gamesLoading.value || gamesError.value || !game || (game.status !== 1 && game.id !== originalGameId.value))
    return toast('请选择可用游戏，或保留文章原有归属', 'error')
  if (!form.value.title.trim()) return toast('请填写标题', 'error')
  if (!form.value.content.trim()) return toast('请填写正文内容', 'error')
  let chapters: import('../../types/api').VideoChapter[]
  try { chapters = parseChapters(chapterText.value) } catch (e) { return toast((e as Error).message, 'error') }
  if (chapters.length && !videoUrl.value) return toast('请先上传主视频，或清空视频时间点', 'error')
  loading.value = true
  try {
    const payload: PostPayload = {
      title: form.value.title,
      content: form.value.content,
      game_id: form.value.game_id,
      category: form.value.category,
      status,
      tags,
      video: videoUrl.value,
      cover: coverUrl.value,
      guide_info: { ...guide.value, video_chapters: chapters },
    }
    let id: number
    let savedStatus = 'draft'
    const storedSnapshot = snapshot()
    if (savedId.value) {
      const result = await postApi.update(savedId.value, { ...payload, content_version: contentVersion.value })
      savedStatus = result.data.status
      contentVersion.value = result.data.content_version
      id = savedId.value
    } else {
      if (!pendingCreate.value) pendingCreate.value = { request_id: createRequestId(), payload: { ...payload, tags: [...payload.tags] } }
      persistDraft()
      const pending = pendingCreate.value
      const res = await postApi.create({ ...pending.payload, request_id: pending.request_id })
      id = res.data.id
      savedId.value = id
      contentVersion.value = res.data.content_version
      savedStatus = res.data.status
      if (res.data.replayed && res.data.content_version > 1) {
        pendingCreate.value = null
        contentVersion.value = 1
        throw { response: { status: 409, data: { message: '已找回原草稿，但它已被其他窗口修改，请重新载入服务器版本' } } }
      }
      // A lost creation response may be retried after the user changes their text.
      // Replay the immutable request first, then save the current content to that same post.
      if (JSON.stringify({ ...pending.payload, status: undefined }) !== JSON.stringify({ ...payload, status: undefined })) {
        pendingCreate.value = null
        const updated = await postApi.update(id, { ...payload, content_version: contentVersion.value })
        contentVersion.value = updated.data.content_version
        savedStatus = updated.data.status
      }
      pendingCreate.value = null
    }
    baseline.value = storedSnapshot
    originalGameId.value = payload.game_id
    originalStatus.value = savedStatus
    removeWritingDraft(storageKey)
    localSaved.value = false
    // 后端 create/update 强制 draft，状态流转唯一入口是 submit（见 4.1 + postController 注释）
    if (status === 'pending' && savedStatus !== 'pending') {
      try { await postApi.submit(id); contentVersion.value++; originalStatus.value = 'pending' }
      catch {
        persistDraft()
        if (alive) toast('文章已保存，但提交审核失败；可重试或到我的作品查看', 'error')
        return
      }
    }
    if (!alive) return
    allowLeave = true
    toast(status === 'pending' || savedStatus === 'pending' ? '已保存，等待审核' : '内容已保存', 'success')
    router.push('/creator/posts')
  } catch (err: unknown) {
    const failure = err as { response?: { status?: number; data?: { message?: string } } }
    if (failure.response?.status === 409) conflictMessage.value = failure.response.data?.message || '文章版本已变化，请重新载入服务器版本'
    persistDraft()
    toast(conflictMessage.value || failure.response?.data?.message || '保存失败，当前内容已保留，请重试', 'error')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div v-if="!editorReady" class="write-page" role="status">
    <p>{{ editorError ? '文章加载失败' : '文章加载中…' }}</p>
    <button v-if="editorError" @click="initEditor">重新加载</button>
  </div>
  <div v-else class="write-page">
    <h2 class="page-title">{{ route.params.id ? '编辑攻略' : '写攻略' }}</h2>
    <div v-if="recoverable" class="draft-note" role="status">
      <p>发现本机未保存草稿（{{ new Date(recoverable.savedAt).toLocaleString('zh-CN') }}）。本机草稿保存7天，上传资源可能提前过期。</p>
      <button class="btn-sub" @click="restoreDraft">恢复草稿</button>
      <button class="btn-sub" @click="discardDraft">忽略草稿</button>
    </div>
    <div v-if="conflictMessage" class="draft-note" role="alert">
      <p>{{ conflictMessage }}。当前编辑内容已保留，重新载入会替换编辑区。</p>
      <button v-if="savedId" class="btn-sub" @click="reloadServerVersion">载入服务器版本</button>
    </div>
    <p v-if="storageFailed" class="draft-note" role="status">本机草稿保存失败，请及时保存到服务器，离开前保留正文。</p>
    <p v-else-if="localSaved" class="draft-status" role="status">未保存内容已暂存本机</p>
    <div :inert="loading || !!recoverable || undefined">
    <p
      v-if="originalStatus === 'published' || originalStatus === 'pending'"
      role="note"
      style="color: var(--amber); margin-bottom: 16px; line-height: 1.6"
    >
      保存修改后将重新排队审核；已发布文章的原版本继续公开，新版本审核通过后替换。
    </p>

    <input v-model="form.title" class="field title-input" placeholder="攻略标题（必填）" />

    <div class="row">
      <select
        v-model="form.game_id"
        class="field select-field"
        :disabled="gamesLoading || !!gamesError"
        aria-label="所属游戏"
      >
        <option disabled :value="0">请选择可用游戏</option>
        <option v-for="g in games.filter((g) => g.status === 1 || g.id === originalGameId)" :key="g.id" :value="g.id">
          {{ g.name }}{{ g.status !== 1 ? '（已停用，保留原归属）' : '' }}
        </option>
      </select>
      <select v-model="form.category" class="field select-field">
        <option v-for="c in CATEGORIES" :key="c" :value="c">{{ c }}</option>
      </select>
    </div>
    <p v-if="gamesError" role="alert">{{ gamesError }} <button @click="loadGames">重试</button></p>
    <p v-else-if="!gamesLoading && !games.some((g) => g.status === 1) && !originalGameId">
      暂无可用游戏，请联系管理员。
    </p>
    <input v-model="form.tags" class="field tags-input" placeholder="标签（逗号分隔）" />

    <details class="guide-editor" :open="!!guide.summary || !!guide.game_version || guide.spoiler !== 'none'">
      <summary>攻略概况 <span>选填，帮助玩家判断是否适用</span></summary>
      <label>先看结论<textarea v-model="guide.summary" class="field" rows="2" maxlength="400" placeholder="简要说明核心打法、路线或搭配结论" /></label>
      <label>适用游戏版本<input v-model="guide.game_version" class="field" maxlength="40" placeholder="例如：游戏补丁版本 / DLC；未确认可留空" /></label>
      <label>前置条件<textarea v-model="guide.prerequisites" class="field" rows="2" maxlength="600" placeholder="建议等级、装备、周目或任务条件" /></label>
      <label>剧透提示<select v-model="guide.spoiler" class="field"><option value="none">无剧透</option><option value="minor">轻微剧透</option><option value="major">重要剧情剧透</option></select></label>
    </details>

    <div class="template-row"><span>正文组织：{{ form.category }}</span><button class="toolbar-btn" type="button" @click="insertTemplate">使用分类模板</button></div>

    <VideoUploader v-model="videoUrl" @busy="videoUploading = $event" />
    <details v-if="videoUrl || chapterText" class="guide-editor">
      <summary>视频时间点 <span>选填，每行一个，按时间递增</span></summary>
      <textarea v-model="chapterText" aria-label="视频时间点" class="field" rows="3" placeholder="00:00 准备与装备&#10;00:15 第二阶段" />
      <p>最多30个，支持 分:秒 或 时:分:秒；请核对实际视频长度。替换视频后请重新核对时间点。</p>
    </details>

    <div class="cover-box">
      <div v-if="!coverUrl" class="cover-empty" @click="coverInput?.click()">
        <span>{{ coverUploading ? '封面上传中…' : '设置封面（可选，16:9）' }}</span>
      </div>
      <div v-else class="cover-preview">
        <img :src="coverUrl" alt="封面" />
        <div class="cover-actions">
          <button class="cover-btn" @click="coverInput?.click()">替换</button>
          <button class="cover-btn cover-btn-danger" @click="removeCover">移除</button>
        </div>
      </div>
      <input ref="coverInput" type="file" accept="image/*" hidden @change="uploadCover" />
    </div>

    <div class="editor-wrap">
      <p v-if="!richReady" class="editor-status" :role="richError ? 'alert' : 'status'">
        {{ richError ? '正文编辑器加载失败，已输入内容仍保留。' : '正在加载正文编辑器…' }}
        <button class="toolbar-btn" type="button" @click="reloadEditorPage">重新加载页面</button>
      </p>
      <RichTextEditor v-model="form.content" :disabled="loading || !!recoverable" @busy="editorUploading = $event" @ready="richReady = $event" />
    </div>

    <div class="actions">
      <p v-if="uploadBusy" role="status">上传处理中，完成后可保存或提交。</p>
      <button class="btn-sub" :disabled="loading || uploadBusy || !richReady" @click="save('draft')">
        {{ originalStatus === 'published' || originalStatus === 'pending' ? '保存并等待审核' : '保存草稿' }}
      </button>
      <button class="btn-main" :disabled="loading || uploadBusy || !richReady" @click="save('pending')">
        {{ loading ? '提交中…' : '提交审核' }}
      </button>
    </div>
    </div>
  </div>
</template>

<style scoped>
.guide-editor { padding:14px; margin-bottom:16px; border:1px solid var(--border-subtle); border-radius:var(--radius-md); color:var(--text-secondary); }
.guide-editor summary { cursor:pointer; color:var(--text-primary); font-size:.88rem; }
.guide-editor summary span, .guide-editor p { font-size:.75rem; color:var(--text-muted); line-height:1.6; }
.guide-editor label { display:block; margin-top:12px; font-size:.8rem; }
.guide-editor .field { display:block; margin-top:6px; }
.template-row { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; font-size:.8rem; color:var(--text-muted); margin:0 0 14px; }
.draft-note { padding:12px; border:1px solid var(--border-subtle); border-radius:8px; margin-bottom:16px; color:var(--text-secondary); line-height:1.6; }
.draft-note button { margin:8px 8px 0 0; }
.draft-status { font-size:.8rem; color:var(--text-muted); margin-bottom:12px; }
.write-page {
  max-width: 900px;
  margin: 0 auto;
  padding: 20px;
}
@media (max-width: 767px) {
  .write-page {
    padding: 12px 14px;
  }
}

.page-title {
  font-family: var(--font-display);
  color: var(--amber);
  font-size: 1.3rem;
  margin-bottom: 16px;
}

.field {
  width: 100%;
  padding: 10px 12px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 0.9rem;
  font-family: inherit;
  outline: none;
  transition: border-color var(--transition-fast);
}
.field:focus {
  border-color: var(--amber);
}
.field::placeholder {
  color: var(--text-muted);
}
.field option {
  background: var(--bg-card);
  color: var(--text-primary);
}

.title-input {
  font-size: 1rem;
  padding: 12px;
  margin-bottom: 12px;
}

.row {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}
.select-field {
  flex: 1;
  min-width: 0;
} /* 游戏/分类对称，各占 50% */
.tags-input {
  width: 100%;
  margin-bottom: 14px;
}
@media (max-width: 767px) {
  .row {
    flex-wrap: wrap;
  }
  .select-field {
    flex: 1 1 100%;
  }
  .tags-input {
    flex: 1 1 100%;
  }
}

/* 封面（可选，16:9） */
.cover-box {
  margin-bottom: 14px;
}
.cover-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 90px;
  border: 1px dashed var(--border-hover);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-muted);
  font-size: 0.85rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.cover-empty:hover {
  border-color: var(--amber);
  color: var(--text-secondary);
}
.cover-preview {
  position: relative;
  border-radius: var(--radius-md);
  overflow: hidden;
  aspect-ratio: 16 / 9;
  border: 1px solid var(--border-subtle);
}
.cover-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.cover-actions {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: flex;
  gap: 6px;
}
.cover-btn {
  padding: 5px 12px;
  font-size: 0.78rem;
  background: var(--bg-sidebar);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
  font-family: inherit;
}
.cover-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}
.cover-btn-danger {
  color: var(--red);
}

/* 工具栏（手机降级模式） */
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.toolbar-btn {
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  background: rgba(232, 168, 56, 0.12);
  color: var(--amber);
  border: 1px solid rgba(232, 168, 56, 0.35);
  cursor: pointer;
  transition: all var(--transition-fast);
  font-family: inherit;
}
.toolbar-btn:hover {
  background: rgba(232, 168, 56, 0.25);
}
.toolbar-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.editor-status {
  font-size: 0.75rem;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

/* TinyMCE 容器 */
.editor-wrap {
  margin-bottom: 16px;
  min-width: 0;
}

.actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}
.btn-sub {
  padding: 10px 24px;
  border-radius: var(--radius-sm);
  font-size: 0.9rem;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
  font-family: inherit;
}
.btn-sub:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.btn-main {
  padding: 10px 24px;
  border-radius: var(--radius-sm);
  font-size: 0.9rem;
  font-weight: 600;
  background: var(--amber);
  border: none;
  color: var(--on-amber);
  cursor: pointer;
  transition: all var(--transition-fast);
  font-family: inherit;
}
.btn-main:hover {
  background: var(--amber-dim);
}
.btn-main:disabled,
.btn-sub:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
