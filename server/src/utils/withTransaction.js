const pool = require('../config/db')

async function attemptTransaction(work) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const result = await work(connection)
    await connection.commit()
    return result
  } catch (err) {
    await connection.rollback()
    throw err
  } finally {
    connection.release()
  }
}

// Opt in only for callbacks whose effects are entirely rolled back by MySQL.
// Do not retry filesystem writes, notifications outside the transaction, or arbitrary errors.
async function withTransaction(work, { deadlockRetries = 0 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await attemptTransaction(work) }
    catch (err) {
      if (err.code !== 'ER_LOCK_DEADLOCK' || attempt >= deadlockRetries) throw err
      await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1) + Math.floor(Math.random() * 30)))
    }
  }
}

module.exports = withTransaction
