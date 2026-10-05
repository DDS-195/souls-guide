import type { InjectionKey, ShallowRef } from 'vue'

// 返回 true 表示页面已处理本次返回（例如详情返回列表）。
export const pageBackKey: InjectionKey<ShallowRef<(() => boolean) | null>> = Symbol('pageBack')
