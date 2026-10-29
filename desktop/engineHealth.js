/* v1.41.0 搜索引擎健康度（纯函数，不依赖 Electron）
 *
 * 搜狗 / 360 的结果解析依赖对方页面 class 名，对方改版即失效。这里按
 * 「连续 N 次解析出 0 条」给引擎记失效标记：聚合与自动回落时跳过失效引擎，
 * 减少无谓的超时等待；标记只存内存，下次启动自动重试（对方修好即恢复）。
 * 只统计「页面取回但解析不到结果」这一类失败——网络不通是全局性的，
 * 不能因为断网就把所有引擎都拉黑。 */

function createEngineHealth({ limit = 5 } = {}) {
  const streak = new Map();   // id -> 连续解析 0 条次数
  return {
    /** ok=true 清零；ok=false 累加 */
    mark(id, ok) {
      if (ok) streak.delete(id);
      else streak.set(id, (streak.get(id) || 0) + 1);
    },
    degraded(id) { return (streak.get(id) || 0) >= limit; },
    /** 给一组引擎按「健康在前、失效在后」稳定排序 */
    orderFirst(ids) {
      return ids.slice().sort((a, b) => (this.degraded(a) ? 1 : 0) - (this.degraded(b) ? 1 : 0));
    },
    /** 失效引擎的显示名列表（用于前端提示） */
    degradedNames(ids, nameOf) {
      return ids.filter(id => this.degraded(id)).map(id => nameOf(id));
    },
    reset() { streak.clear(); },
    _streak: streak,
  };
}

module.exports = { createEngineHealth };
