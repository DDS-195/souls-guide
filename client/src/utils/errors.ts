import axios from 'axios'

interface ErrorEnvelope {
  message?: string
}

/** 从 Axios/API 或普通 Error 中安全提取面向用户的错误文案。 */
export function errorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError<ErrorEnvelope>(error)) {
    return error.response?.data?.message || error.message || fallback
  }
  return error instanceof Error && error.message ? error.message : fallback
}

export function errorStatus(error: unknown): number | undefined {
  return axios.isAxiosError(error) ? error.response?.status : undefined
}
