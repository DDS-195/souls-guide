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
// 媒体套件使用随机字节验证分片/MD5，不把它们伪装成可解码视频；真实 ffprobe 由生产配置强制启用。
process.env.SKIP_MEDIA_PROBE = 'true'
const { prepareTestDatabase, dropTestDatabase } = require('./setupTestDatabase')

async function main() {
  console.log('='.repeat(60))
  console.log('SoulsGuide 后端测试套件（真实 MySQL + 真实 HTTP，端口 3199）')
  console.log('='.repeat(60))

  let databaseName
  let H
  let server
  let suiteError = false

  try {
    // Only take cleanup ownership after this run successfully creates the database.
    // Partial initialization is cleaned up; an existing database is never dropped.
    await prepareTestDatabase({ onCreated: name => { databaseName = name } })
    console.log(`[test] 独立数据库：${databaseName}（本轮结束自动销毁）`)
    H = require('./helpers')
    const suites = [
      require('./00-contract.suite.js'),
      require('./01-users.suite.js'),
      require('./02-games.suite.js'),
      require('./03-posts.suite.js'),
      require('./04-interact.suite.js'),
      require('./05-admin.suite.js'),
      require('./06-media.suite.js'),
      require('./07-safety.suite.js'),
      require('./08-concurrency.suite.js'),
      require('./09-analytics.suite.js'),
      require('./10-review.suite.js'),
      require('./11-applications.suite.js'),
      require('./12-games-lifecycle.suite.js'),
      require('./13-notifications.suite.js'),
      require('./14-user-management.suite.js'),
      require('./15-logs.suite.js'),
      require('./16-notification-center.suite.js'),
      require('./17-home-feed.suite.js'),
      require('./18-comment-pagination.suite.js'),
      require('./19-error-boundaries.suite.js'),
      require('./20-production.suite.js'),
      require('./21-deployed-media.suite.js'),
      require('./22-writing.suite.js'),
      require('./23-guide-experience.suite.js'),
      require('./24-personal-feed.suite.js'),
      require('./25-audit-regressions.suite.js'),
      require('./26-post-revisions.suite.js'),
    ]
    server = require('../server.js')
    await server.start()

    for (const suite of suites) {
      await suite()
    }
  } catch (e) {
    suiteError = true
    console.error('\n套件执行异常：', e)
  } finally {
    try {
      if (H) {
        await H.cleanup()
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
        if (total !== 0) suiteError = true
      }
    } catch (error) {
      suiteError = true
      console.error('[test] 清理或残留复核失败:', error.message)
    } finally {
      // 任一步骤失败仍尝试后续回收；不能因为查询失败跳过停服/断开/删库。
      try {
        if (server) await server.stop()
      } catch (error) {
        suiteError = true
        console.error('[test] 测试服务关闭失败:', error.message)
      } finally {
        try {
          if (H) await H.pool.end()
        } catch (error) {
          suiteError = true
          console.error('[test] 测试连接关闭失败:', error.message)
        } finally {
          if (databaseName) {
            try {
              await dropTestDatabase(databaseName)
              console.log(`[test] 已销毁独立数据库：${databaseName}`)
            } catch (error) {
              suiteError = true
              console.error('[test] 隔离数据库销毁失败:', error.message)
            }
          }
        }
      }
    }
  }

  const ok = H ? H.summary() : false
  process.exit(ok && !suiteError ? 0 : 1)
}

if (require.main === module) main().catch(error => {
  console.error('[test] Runner unexpected failure:', error.message)
  process.exit(1)
})
module.exports = { main }
