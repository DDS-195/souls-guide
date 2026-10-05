const fs = require('fs')
const path = require('path')
const mysql = require('mysql2/promise')
const bcrypt = require('bcrypt')

const SERVER_ROOT = path.join(__dirname, '..')

function resolveTestDatabaseName() {
  const configured = process.env.TEST_DB_NAME
  const source = configured || `${process.env.DB_NAME || 'souls_guide'}_test`
  if (!/^[A-Za-z0-9_]+_test$/.test(source)) {
    throw new Error(`拒绝运行测试：测试库名必须以 _test 结尾，当前为 ${source}`)
  }
  return source
}

function adminConnectionOptions() {
  return {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
    user: process.env.TEST_DB_ADMIN_USER || process.env.DB_USER,
    password: process.env.TEST_DB_ADMIN_PASSWORD || process.env.DB_PASSWORD,
    multipleStatements: true,
    timezone: '+08:00',
  }
}

function targetScript(filename, databaseName) {
  return fs.readFileSync(path.join(SERVER_ROOT, 'db', filename), 'utf8')
    .replace(/CREATE DATABASE IF NOT EXISTS souls_guide/g, `CREATE DATABASE IF NOT EXISTS \`${databaseName}\``)
    .replace(/USE souls_guide;/g, `USE \`${databaseName}\`;`)
}

async function prepareTestDatabase({ onCreated = () => {} } = {}) {
  const databaseName = resolveTestDatabaseName()
  process.env.DB_NAME = databaseName
  process.env.NODE_ENV = 'test'
  process.env.ADMIN_INITIAL_PASSWORD = ''

  const db = await mysql.createConnection(adminConnectionOptions())
  try {
    // CREATE without IF NOT EXISTS refuses another run's database; never erase it.
    await db.query(`CREATE DATABASE \`${databaseName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    onCreated(databaseName)
    await db.query(targetScript('schema.sql', databaseName))
    await db.query(targetScript('seed.sql', databaseName))
    const password = await bcrypt.hash('TestAdmin!123', 4)
    await db.execute(
      `INSERT INTO \`${databaseName}\`.users (username, password, role, apply_status)
       VALUES ('admin', ?, 'admin', 'approved')`,
      [password]
    )
  } finally {
    await db.end()
  }
  return databaseName
}

async function dropTestDatabase(databaseName) {
  if (!/^[A-Za-z0-9_]+_test$/.test(databaseName)) {
    throw new Error(`拒绝删除非测试库：${databaseName}`)
  }
  const db = await mysql.createConnection(adminConnectionOptions())
  try {
    await db.query(`DROP DATABASE IF EXISTS \`${databaseName}\``)
  } finally {
    await db.end()
  }
}

module.exports = { prepareTestDatabase, dropTestDatabase, resolveTestDatabaseName }
