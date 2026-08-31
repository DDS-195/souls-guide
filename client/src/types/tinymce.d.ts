// D22 富文本接入（9.2-12 ②）：tinymce 8 npm 包仅为根入口提供类型（tinymce.d.ts），
// bundler 集成所需的子路径模块（models / themes / icons / plugins）均无类型声明。
// 此处显式声明空模块，仅用于通过 vue-tsc 类型检查；实际打包由 vite 处理（见 Write.vue 顶部导入）。
// 依据：设计文档 5.4「全局类型如确可建 src/types/（先更新本文档）」——本文档已同步。
declare module 'tinymce/models/dom/model'
declare module 'tinymce/themes/silver'
declare module 'tinymce/icons/default'
declare module 'tinymce/plugins/advlist'
declare module 'tinymce/plugins/lists'
declare module 'tinymce/plugins/link'
declare module 'tinymce/plugins/image'
declare module 'tinymce/plugins/table'
declare module 'tinymce/plugins/fullscreen'
declare module 'tinymce/plugins/code'
declare module 'tinymce/plugins/wordcount'
