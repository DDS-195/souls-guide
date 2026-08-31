import axios, { type AxiosRequestConfig } from 'axios'
import { useUserStore } from '@/stores/user'
import router from '@/router'

const request = axios.create({
  baseURL: '/api',
  timeout: 15000,
})

// 请求拦截器：自动带 token
request.interceptors.request.use((config) => {
  const userStore = useUserStore()
  if (userStore.token) {
    config.headers.Authorization = `Bearer ${userStore.token}`
  }
  return config
})

// 响应拦截器：统一解包 + 错误处理
request.interceptors.response.use(
  (res) => res.data,
  (err) => {
    if (err.response?.status === 401) {
      const userStore = useUserStore()
      userStore.logout()
      router.push('/login')
    }
    return Promise.reject(err)
  },
)

/**
 * HTTP 客户端类型收窄（2026-08-16 类型止血）：
 * 响应拦截器返回的是完整信封 res.data（ApiEnvelope），与 axios 默认 Promise<AxiosResponse> 不符。
 * 通过 HttpClient 接口声明真实返回类型，api/index.ts 据此写泛型（如 get<ApiEnvelope<User>>）。
 */
export interface HttpClient {
  get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T>
  post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>
  put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>
  delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T>
}

export default request as unknown as HttpClient
