<script setup lang="ts">
import { watch, onBeforeUnmount } from 'vue'
import Editor from '@tinymce/tinymce-vue'
import type { RawEditorOptions, Editor as TinyEditor } from 'tinymce/tinymce'
import { mediaApi } from '../api'
import { compressImage } from '../utils/image'
import { useTheme } from '../utils/theme'
defineProps<{ disabled?: boolean }>()
const emit = defineEmits<{ (e: 'busy', value: boolean): void; (e: 'ready', value: boolean): void }>()
let pendingImages = 0
let alive = true
onBeforeUnmount(() => { alive = false; emit('busy', false); emit('ready', false) })

// 桌面与手机复用一个实例，旋转屏幕不会卸载正文或中断上传；仅在写作页异步加载。
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
import editorContentCss from 'tinymce/skins/ui/oxide-dark/content.min.css?inline'
import documentContentCss from 'tinymce/skins/content/default/content.min.css?inline'
import '../assets/tinymce-theme.css'

const model = defineModel<string>({ required: true })
const { isDark } = useTheme()
let activeEditor: TinyEditor | null = null
function applyEditorTheme() {
  if (!activeEditor?.initialized) return
  const doc = activeEditor.getDoc()
  let style = doc.getElementById('souls-guide-theme') as HTMLStyleElement | null
  if (!style) {
    style = doc.createElement('style')
    style.id = 'souls-guide-theme'
    doc.head.appendChild(style)
  }
  style.textContent = isDark.value ? contentStyleDark : contentStyleLight
  doc.documentElement.style.colorScheme = isDark.value ? 'dark' : 'light'
}
watch(isDark, applyEditorTheme, { flush: 'post' })
onBeforeUnmount(() => {
  activeEditor = null
})

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
  '@media(max-width:767px){body{font-size:16px}}',
].join('')

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
  '@media(max-width:767px){body{font-size:16px}}',
].join('')

const editorInit: RawEditorOptions = {
  setup: (editor) => {
    activeEditor = editor
    editor.on('init', () => { applyEditorTheme(); if (alive) emit('ready', true) })
    editor.on('remove', () => {
      if (activeEditor === editor) activeEditor = null
    })
  },
  height: 480,
  menubar: false,
  branding: false,
  language: 'zh_CN',
  language_url: '/tinymce-langs/zh_CN.js',
  // All styles are bundled: never request missing /skins files from the SPA.
  skin: false,
  content_css: false,
  plugins: 'advlist lists link image table fullscreen code wordcount',
  toolbar:
    'undo redo | blocks | bold italic underline strikethrough | bullist numlist | link image table | fullscreen code',
  toolbar_mode: 'sliding',
  mobile: {
    height: 400,
    menubar: false,
    toolbar: 'undo redo | blocks | bold italic | bullist numlist | image link | fullscreen',
    toolbar_mode: 'scrolling',
  },
  // 直接选择设备相册，不要求手机作者手工输入图片 URL。
  image_uploadtab: true,
  content_style: [editorContentCss, documentContentCss, isDark.value ? contentStyleDark : contentStyleLight].join('\n'),
  images_upload_handler: async (blobInfo) => {
    pendingImages++
    emit('busy', true)
    try {
    const blob = blobInfo.blob()
    const file = new File([blob], blobInfo.filename() || 'image.png', { type: blob.type || 'image/png' })
    const compressed = await compressImage(file, { maxWidth: 1920, quality: 0.8 })
    const res = await mediaApi.uploadImage(compressed)
    return res.data.url
    } finally {
      pendingImages--
      if (alive) emit('busy', pendingImages > 0)
    }
  },
}
</script>

<template>
  <Editor v-model="model" :init="editorInit" :disabled="disabled" license-key="gpl" />
</template>
