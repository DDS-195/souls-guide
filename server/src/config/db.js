const mysql = require('mysql2/promise')

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  connectTimeout: 3000,
  queueLimit: 100,
  // 2026-08-13 修复（P2-4）：固定东八区，DATETIME 读写不再依赖部署机时区（本地/容器行为一致）
  timezone: '+08:00',
})

// mysql2 的 timezone 负责 DATETIME 序列化；显式设置数据库会话时区，保证 NOW()/CURDATE()/DATE() 也按东八区计算。
pool.on('connection', (connection) => {
  connection.query("SET time_zone = '+08:00'", (err) => {
    if (err) console.error('[mysql pool] 设置会话时区失败:', err.message)
  })
})

// 2026-08-13 修复（P1-6）：监听空闲连接错误——MySQL 重启/断网时空闲连接 emit 'error'，
// 无监听器会升级为 uncaughtException 直接杀进程（server.js 兜底 exit）。业务查询错误仍走 execute 的 reject。
pool.on('error', (err) => {
  console.error('[mysql pool] 空闲连接错误（已忽略，业务查询错误由 asyncHandler 处理）:', err.message)
})

module.exports = pool
