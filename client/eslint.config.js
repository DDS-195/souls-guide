// SoulsGuide ESLint 配置（2026-08-16 批 4 代码规范，flat config）
// 依赖（R2 例外，用户批准）：eslint + @eslint/js + typescript-eslint + eslint-plugin-vue + eslint-config-prettier
// 策略：JS/TS/Vue 三套推荐规则 + Prettier 兼容（eslint-config-prettier 关闭格式冲突规则），
// 项目现状务实放宽三条（注释已说明），随后续改造逐步收紧。
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import prettierConfig from 'eslint-config-prettier'

export default tseslint.config(
  // 忽略构建产物/依赖/静态资源与配置文件自身
  { ignores: ['dist/**', 'node_modules/**', 'public/**', 'vite.config.ts', 'tsconfig*.json'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  prettierConfig,
  {
    files: ['**/*.{ts,vue}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      // Vue SFC 的 <script> 用 TS 解析器（vue-eslint-parser 委托给 typescript-eslint）
      parserOptions: { parser: tseslint.parser },
    },
    rules: {
      // 务实放宽（后续收紧）：
      '@typescript-eslint/no-explicit-any': 'off', // 页面级 any 仍在（类型止血完成后逐批收紧）
      'vue/multi-word-component-names': 'off', // 单文件组件名（App.vue 等）
      'vue/html-self-closing': 'off', // 模板自闭合风格交 Prettier
      'no-undef': 'off', // TS 项目的 DOM 全局（window/File/HTMLDivElement）由 vue-tsc 的 DOM lib 类型检查负责，ESLint 侧冗余
      'vue/no-v-html': 'off', // PostBody 的 v-html 是 DOMPurify 消毒后的唯一展示入口（D22 设计决策，有意为之）
    },
  },
)
