function createWorkQueue({ concurrency = 1, maxWaiting = 2, waitMs = 120000 } = {}) {
  let active = 0
  const waiting = []
  const busy = () => Object.assign(new Error('视频处理繁忙，请稍后重试'), { statusCode: 503 })
  async function run(work) {
    if (active >= concurrency) {
      if (waiting.length >= maxWaiting) throw busy()
      await new Promise((resolve, reject) => {
        const item = { resolve, timer: null }
        item.timer = setTimeout(() => {
          const index = waiting.indexOf(item)
          if (index >= 0) waiting.splice(index, 1)
          reject(busy())
        }, waitMs)
        waiting.push(item)
      })
    } else active++
    try { return await work() }
    finally {
      const next = waiting.shift()
      if (next) { clearTimeout(next.timer); next.resolve() } // transfer the occupied slot
      else active--
    }
  }
  return { run }
}
module.exports = createWorkQueue
