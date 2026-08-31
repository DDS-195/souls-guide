// SoulsGuide 后端测试入口（2026-08-13，零依赖）
// 用法：cd server && node test/run-all.js
//   1. 加载 server/.env（DB 连接）→ 启动真实 server.js（端口 3199，不影响开发 3000）
//   2. 顺序执行 01-07 套件（用户/游戏/文章/互动/管理/媒体/安全）
//   3. 统一清理测试数据（DB 行 + 磁盘文件）→ 输出汇总与退出码
const path = require('path')
// 固定工作目录为 server 根（server.js 的 dotenv/静态路径均以 cwd 解析，从任意位置运行本入口都一致）
process.chdir(path.join(__dirname, '..'))
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

process.env.PORT = '3199' // 测试专用端口

const H = require('./helpers')

const SUITES = [
  ['01-users.suite.js', require('./01-users.suite.js')],
  ['02-games.suite.js', require('./02-games.suite.js')],
  ['03-posts.suite.js', require('./03-posts.suite.js')],
  ['04-interact.suite.js', require('./04-interact.suite.js')],
  ['05-admin.suite.js', require('./05-admin.suite.js')],
  ['06-media.suite.js', require('./06-media.suite.js')],
  ['07-safety.suite.js', require('./07-safety.suite.js')],
  ['08-concurrency.suite.js', require('./08-concurrency.suite.js')],
]

async function main() {
  console.log('='.repeat(60))
  console.log('SoulsGuide 后端测试套件（真实 MySQL + 真实 HTTP，端口 3199）')
  console.log('='.repeat(60))

  // 启动真实服务
  require('../server.js')
  await new Promise(r => setTimeout(r, 1200))

  try {
    for (const [file, suite] of SUITES) {
      await suite()
    }
  } catch (e) {
    console.error('\n套件执行异常：', e)
  } finally {
    // 零残留：DB 行 + 磁盘文件统一回收
    await H.cleanup()
    // 零残留复核：按登记 id 核对 DB + 磁盘
    const fs = require('fs')
    const cnt = async (table, ids) => {
      if (!ids.length) return 0
      const marks = ids.map(() => '?').join(',')
      const [rows] = await H.pool.execute(`SELECT COUNT(*) AS c FROM ${table} WHERE id IN (${marks})`, ids)
      return +rows[0].c
    }
    const uLeft = await cnt('users', H.created.users)
    const pLeft = await cnt('posts', H.created.posts)
    const gLeft = await cnt('games', H.created.games)
    const aLeft = await cnt('announcements', H.created.announcements)
    const fLeft = H.created.files.filter(f => fs.existsSync(f)).length
    const dLeft = H.created.dirs.filter(d => fs.existsSync(d)).length
    const total = uLeft + pLeft + gLeft + aLeft + fLeft + dLeft
    console.log('\n[零残留复核] 用户:' + uLeft + ' 文章:' + pLeft + ' 游戏:' + gLeft + ' 公告:' + aLeft + ' 磁盘文件:' + fLeft + ' 临时目录:' + dLeft)
    console.log('[零残留复核] ' + (total === 0 ? '✅ 全部回收' : '❌ 存在 ' + total + ' 项残留'))
  }

  const ok = H.summary()
  process.exit(ok ? 0 : 1)
}

main()
