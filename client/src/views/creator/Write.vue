<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Editor from '@tinymce/tinymce-vue'
import type { RawEditorOptions } from 'tinymce/tinymce'
import { gameApi, postApi, mediaApi } from '../../api'
import VideoUploader from '../../components/VideoUploader.vue'
import { toast } from '../../utils/toast'
import { compressImage } from '../../utils/image'
import { useTheme } from '../../utils/theme'

// D22 富文本（9.2-12 ②）：TinyMCE 8 bundler 集成。导入顺序：核心 → model → theme → icons → 各插件 → 暗色皮肤。
// 皮肤 css 随 bundle 注入主文档（init skin 仍会触发一次皮肤请求，404 属预期，样式不受影响）；
// 编辑区 iframe 内样式走 content_style 内联注入（不依赖 content_css 网络加载）。
import 'tinymce/tinymce'
import 'tinymce/models/dom/model'
import 'tinymce/themes/silver'
import 'tinymce/icons/default'
import 'tinymce/plugins/advlist'
import 'tinymce/plugins/lists'
import 'tinymce/plugins/link'
import 'tinymce/plugins/image'
import 'tinymce/plugins/table'
import 'tinymce/plugins/fullscreen'
import 'tinymce/plugins/code'
import 'tinymce/plugins/wordcount'
import 'tinymce/skins/ui/oxide-dark/skin.min.css'
// 编辑器主题覆盖 css（必须在 skin css 之后导入）：.tox UI 全部用 :root 设计变量，
// 暗色/亮色（html.light-theme）自动跟随，皮肤颜色由此文件接管（oxide-dark 硬编码，无变量可覆盖）
import '../../assets/tinymce-theme.css'

/**
 * 写攻略（D12/D13，D22 富文本版）：
 * 标题 → 游戏/分类/标签 → 主视频（分片断点续传）→ 封面（可选）→ 富文本正文（TinyMCE，PC）
 * 保存 body：{ title, content, game_id, category, status, tags[], video, cover }
 * 编辑回填（D22 方案 A，2026-08-09）：getDetail 对 draft/pending/rejected 返回 404，
 * 回填唯一通道是 getMyList —— my/list 每项带 content/tags/media（video）/cover，find 出目标文章
 * 手机端（6.6）：正文降级为富文本编辑框（textarea），图片按钮插入 <img> 标签
 */
const router = useRouter()
const route = useRoute()
const games = ref<any[]>([])
const CATEGORIES = ['BOSS攻略', '新手入门', '剧情解析', '装备评测', '全收集', 'Build分享']
const form = ref({ title: '', content: '', game_id: 1, category: 'BOSS攻略', tags: '' })
const videoUrl = ref<string | null>(null)
const coverUrl = ref<string | null>(null)
const loading = ref(false)
const imgUploading = ref(false) // 手机降级模式：图片上传中
const coverUploading = ref(false)
const textareaRef = ref<HTMLTextAreaElement | null>(null) // 手机降级模式
const imageInput = ref<HTMLInputElement | null>(null) // 手机降级模式
const coverInput = ref<HTMLInputElement | null>(null)

// 6.6 手机端取舍：写攻略降级为富文本编辑框（TinyMCE 仅 PC 渲染）
const isMobile = ref(window.innerWidth < 768)
const onResize = () => {
  isMobile.value = window.innerWidth < 768
}
window.addEventListener('resize', onResize)
// 监听器必须随组件卸载清理：写攻略页每次进入都会注册，不清理则泄漏全局监听器（多次进出后重复响应）
onUnmounted(() => window.removeEventListener('resize', onResize))

onMounted(async () => {
  try {
    const res = await gameApi.getList()
    games.value = res.data
  } catch {
    /* 游戏列表加载失败不阻塞编辑 */
  }
  if (route.params.id) {
    try {
      // D22 方案 A：draft/pending/rejected 的文章 getDetail 404，统一从 my/list 回填（published 也在列）
      const { data } = await postApi.getMyList({ page: 1, pageSize: 100 })
      const item = (data.list || []).find((p: any) => p.id === +route.params.id)
      if (!item) throw new Error('not found')
      form.value.title = item.title
      form.value.content = item.content
      form.value.game_id = item.game_id
      form.value.category = item.category
      const t = item.tags
      form.value.tags = Array.isArray(t) ? t.join(',') : t || ''
      videoUrl.value = item.media?.find((m: any) => m.type === 'video')?.url || null
      coverUrl.value = item.cover || null
    } catch {
      toast('攻略加载失败', 'error')
    }
  }
})

/** TinyMCE 初始化（9.2-12 ②）：皮肤固定 oxide-dark，UI 颜色由 tinymce-theme.css 接管（随主题）；
 * content_style 按 isDark 切换两套写死色值（iframe 内 CSS 变量不可继承），
 * 主题切换时通过 :key 重建编辑器（tinymce-vue 不响应 init 变化）。 */
const { isDark } = useTheme()
const themeKey = computed(() => (isDark.value ? 'dark' : 'light'))

/** 编辑区样式 — 暗色（对应 style.css 设计变量值） */
const contentStyleDark = [
  "body { font-family: 'Inter', -apple-system, 'Noto Sans SC', 'PingFang SC', sans-serif; font-size: 14px; color: #e2e8f0; background: #1a1f26; line-height: 1.8; }",
  'p { margin: 0 0 1em; }',
  "h1,h2,h3,h4 { font-family: 'Cinzel', 'Times New Roman', serif; color: #e2e8f0; margin: 1.2em 0 0.6em; line-height: 1.4; }",
  'h1 { font-size: 1.5rem; } h2 { font-size: 1.3rem; } h3 { font-size: 1.15rem; } h4 { font-size: 1rem; }',
  'ul,ol { padding-left: 1.5em; margin: 0 0 1em; }',
  'a { color: #3b9db5; }',
  'blockquote { border-left: 3px solid #e8a838; background: rgba(232,168,56,0.08); margin: 0 0 1em; padding: 0.5em 1em; color: #94a3b8; }',
  'code { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12); padding: 1px 6px; border-radius: 4px; font-size: 0.85em; }',
  'pre { background: #14191e; border: 1px solid rgba(255,255,255,0.12); padding: 12px 16px; border-radius: 8px; overflow-x: auto; margin: 0 0 1em; }',
  'pre code { border: none; padding: 0; background: transparent; }',
  'table { border-collapse: collapse; width: 100%; margin: 0 0 1em; }',
  'th,td { border: 1px solid rgba(255,255,255,0.16); padding: 6px 10px; }',
  'img { max-width: 100%; height: auto; }',
  'hr { border: none; border-top: 1px solid rgba(255,255,255,0.16); margin: 1.2em 0; }',
].join('')

/** 编辑区样式 — 亮色（对应 style.css :root.light-theme 值） */
const contentStyleLight = [
  "body { font-family: 'Inter', -apple-system, 'Noto Sans SC', 'PingFang SC', sans-serif; font-size: 14px; color: #2c2416; background: #e8e0d0; line-height: 1.8; }",
  'p { margin: 0 0 1em; }',
  "h1,h2,h3,h4 { font-family: 'Cinzel', 'Times New Roman', serif; color: #2c2416; margin: 1.2em 0 0.6em; line-height: 1.4; }",
  'h1 { font-size: 1.5rem; } h2 { font-size: 1.3rem; } h3 { font-size: 1.15rem; } h4 { font-size: 1rem; }',
  'ul,ol { padding-left: 1.5em; margin: 0 0 1em; }',
  'a { color: #5a7d9a; }',
  'blockquote { border-left: 3px solid #d4892a; background: rgba(212,137,42,0.10); margin: 0 0 1em; padding: 0.5em 1em; color: #6b5d4f; }',
  'code { background: rgba(0,0,0,0.06); border: 1px solid rgba(0,0,0,0.12); padding: 1px 6px; border-radius: 4px; font-size: 0.85em; }',
  'pre { background: #ede6d8; border: 1px solid rgba(0,0,0,0.12); padding: 12px 16px; border-radius: 8px; overflow-x: auto; margin: 0 0 1em; }',
  'pre code { border: none; padding: 0; background: transparent; }',
  'table { border-collapse: collapse; width: 100%; margin: 0 0 1em; }',
  'th,td { border: 1px solid rgba(0,0,0,0.16); padding: 6px 10px; }',
  'img { max-width: 100%; height: auto; }',
  'hr { border: none; border-top: 1px solid rgba(0,0,0,0.16); margin: 1.2em 0; }',
].join('')

const editorInit = computed<RawEditorOptions>(() => ({
  height: 480,
  menubar: false,
  branding: false,
  language: 'zh_CN',
  // 中文语言包：npm 包不含非 en 语言包，自备 zh_CN.js 放 public/ 由运行时加载（2.1 备注）
  language_url: '/tinymce-langs/zh_CN.js',
  skin: 'oxide-dark',
  plugins: 'advlist lists link image table fullscreen code wordcount',
  toolbar:
    'undo redo | blocks | bold italic underline strikethrough | bullist numlist | link image table | fullscreen code',
  content_style: isDark.value ? contentStyleDark : contentStyleLight,
  // 工具栏图片上传：压缩（1920px/0.8，10.1 契约）→ 上传 → resolve 图片 URL 插入正文
  images_upload_handler: async (blobInfo) => {
    const blob = blobInfo.blob()
    const file = new File([blob], blobInfo.filename() || 'image.png', { type: blob.type || 'image/png' })
    const compressed = await compressImage(file, { maxWidth: 1920, quality: 0.8 })
    const res = await mediaApi.uploadImage(compressed)
    return res.data.url
  },
}))

/** 在 textarea 光标处插入文本（手机降级模式），无焦点时追加到末尾 */
function insertAtCursor(text: string) {
  const ta = textareaRef.value
  if (!ta) {
    form.value.content += text
    return
  }
  const start = ta.selectionStart
  const end = ta.selectionEnd
  form.value.content = form.value.content.slice(0, start) + text + form.value.content.slice(end)
  nextTick(() => {
    ta.focus()
    ta.selectionStart = ta.selectionEnd = start + text.length
  })
}

async function uploadAndInsertImage(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  imgUploading.value = true
  try {
    // 图片压缩（10.1 契约）：内嵌图 1920px/0.8，Canvas→WebP，压缩失败则原图上传（后端 5MB 兜底）
    const compressed = await compressImage(file, { maxWidth: 1920, quality: 0.8 })
    const res = await mediaApi.uploadImage(compressed)
    // D22：正文为 HTML，手机降级模式插 <img> 标签（markdown 语法不再生效）
    insertAtCursor(`<img src="${res.data.url}" alt="图片" />`)
    toast('图片已插入正文', 'success')
  } catch {
    toast('图片上传失败（≤5MB）', 'error')
  } finally {
    imgUploading.value = false
  }
}

async function uploadCover(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  coverUploading.value = true
  try {
    // 图片压缩（10.1 契约）：封面 800px/0.85，Canvas→WebP，压缩失败则原图上传（后端 5MB 兜底）
    const compressed = await compressImage(file, { maxWidth: 800, quality: 0.85 })
    const res = await mediaApi.uploadImage(compressed)
    coverUrl.value = res.data.url
    toast('封面已设置', 'success')
  } catch {
    toast('封面上传失败（≤5MB）', 'error')
  } finally {
    coverUploading.value = false
  }
}

async function save(status: 'draft' | 'pending') {
  if (!form.value.title.trim()) return toast('请填写标题', 'error')
  if (!form.value.content.trim()) return toast('请填写正文内容', 'error')
  loading.value = true
  try {
    const payload: any = {
      title: form.value.title,
      content: form.value.content,
      game_id: form.value.game_id,
      category: form.value.category,
      status,
      tags: form.value.tags.split(/[,，]/).filter(Boolean),
      video: videoUrl.value,
      cover: coverUrl.value,
    }
    let id: number
    if (route.params.id) {
      await postApi.update(+route.params.id, payload)
      id = +route.params.id
    } else {
      const res: any = await postApi.create(payload)
      id = res.data.id
    }
    // 后端 create/update 强制 draft，状态流转唯一入口是 submit（见 4.1 + postController 注释）
    if (status === 'pending') await postApi.submit(id)
    toast(status === 'pending' ? '已提交审核' : '草稿已保存', 'success')
    router.push('/creator/posts')
  } catch {
    toast('保存失败，请重试', 'error')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="write-page">
    <h2 class="page-title">{{ route.params.id ? '编辑攻略' : '写攻略' }}</h2>

    <input v-model="form.title" class="field title-input" placeholder="攻略标题（必填）" />

    <div class="row">
      <select v-model="form.game_id" class="field select-field">
        <option v-for="g in games" :key="g.id" :value="g.id">{{ g.name }}</option>
      </select>
      <select v-model="form.category" class="field select-field">
        <option v-for="c in CATEGORIES" :key="c" :value="c">{{ c }}</option>
      </select>
    </div>
    <input v-model="form.tags" class="field tags-input" placeholder="标签（逗号分隔）" />

    <VideoUploader v-model="videoUrl" />

    <div class="cover-box">
      <div v-if="!coverUrl" class="cover-empty" @click="coverInput?.click()">
        <span>{{ coverUploading ? '封面上传中…' : '设置封面（可选，16:9）' }}</span>
      </div>
      <div v-else class="cover-preview">
        <img :src="coverUrl" alt="封面" />
        <div class="cover-actions">
          <button class="cover-btn" @click="coverInput?.click()">替换</button>
          <button class="cover-btn cover-btn-danger" @click="coverUrl = null">移除</button>
        </div>
      </div>
      <input ref="coverInput" type="file" accept="image/*" hidden @change="uploadCover" />
    </div>

    <!-- 正文：PC TinyMCE 富文本 / 手机降级富文本编辑框（6.6） -->
    <!-- license-key prop 必须传：tinymce-vue 用 props.licenseKey 覆盖 init 配置，默认 undefined 导致编辑器禁用（GPL 模式） -->
    <!-- :key 按主题重建编辑器：tinymce-vue 初始化后不响应 init 变化，主题切换需重建以应用另一套 content_style -->
    <div v-if="!isMobile" class="editor-wrap">
      <Editor :key="themeKey" v-model="form.content" :init="editorInit" license-key="gpl" />
    </div>
    <div v-else>
      <div class="toolbar">
        <button class="toolbar-btn" :disabled="imgUploading" @click="imageInput?.click()">
          {{ imgUploading ? '图片上传中…' : '插入图片' }}
        </button>
        <span class="toolbar-hint">手机端使用富文本编辑框：插入的图片为 &lt;img&gt; 标签，排版效果与 PC 一致</span>
        <input ref="imageInput" type="file" accept="image/*" hidden @change="uploadAndInsertImage" />
      </div>
      <textarea
        ref="textareaRef"
        v-model="form.content"
        class="field content-input"
        placeholder="攻略正文（必填）…"
        rows="18"
      ></textarea>
    </div>

    <div class="actions">
      <button class="btn-sub" :disabled="loading" @click="save('draft')">保存草稿</button>
      <button class="btn-main" :disabled="loading" @click="save('pending')">
        {{ loading ? '提交中…' : '提交审核' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
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
.toolbar-hint {
  font-size: 0.75rem;
  color: var(--text-muted);
}

/* TinyMCE 容器 */
.editor-wrap {
  margin-bottom: 16px;
}

.content-input {
  line-height: 1.7;
  resize: vertical;
  margin-bottom: 16px;
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
