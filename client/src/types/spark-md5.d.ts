/**
 * spark-md5@3.0.2 本地类型声明（D13 已批准引入运行时依赖）
 * 与 @types/spark-md5 同构，避免额外安装类型包
 */
declare module 'spark-md5' {
  class SparkMD5 {
    static hash(str: string, raw?: boolean): string
    static hashBinary(content: string, raw?: boolean): string
    constructor()
    append(data: string | ArrayBuffer, utf8Encoding?: boolean): void
    appendBinary(data: string): void
    end(raw?: boolean): string
    reset(): void
    destroy(): void
  }
  namespace SparkMD5 {
    class ArrayBuffer extends SparkMD5 {}
  }
  export = SparkMD5
}
