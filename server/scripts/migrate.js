require('dotenv').config()
require('../src/utils/productionConfig')()

const pool = require('../src/config/db')
const runMigrations = require('../src/utils/migrate')

runMigrations()
  .then(() => {
    console.log('[db] migrations up to date')
  })
  .catch((error) => {
    console.error('[db] migration failed:', error.message)
    process.exitCode = 1
  })
  .finally(() => pool.end())
