// 実行中の分析ジョブを分析ごとにブラウザへ記録し、ページを開き直しても結果を受け取れるようにする
const keyFor = projectId => `rf_analyzer_pending_job_${projectId}`

export function savePendingJob(projectId, job, storage) {
  try { (storage ?? globalThis.localStorage).setItem(keyFor(projectId), JSON.stringify(job)) } catch { /* 保存できない環境では引き継がない */ }
}

export function readPendingJob(projectId, storage) {
  try {
    const job = JSON.parse((storage ?? globalThis.localStorage).getItem(keyFor(projectId)))
    return job && typeof job.jobId === 'string' ? job : null
  } catch {
    return null
  }
}

export function clearPendingJob(projectId, storage) {
  try { (storage ?? globalThis.localStorage).removeItem(keyFor(projectId)) } catch { /* 何もしない */ }
}

// 開き直した分析の目的変数・説明変数が、ジョブを始めたときと同じなら引き継ぐ
export function canResume(job, target, features) {
  return !!job && job.target === target && JSON.stringify(job.features) === JSON.stringify(features)
}
