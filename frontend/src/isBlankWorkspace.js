export function isBlankWorkspace(snapshot, version) {
  const name = snapshot.name?.trim() || '新しい分析'
  return version === 0 && !snapshot.file_id && name === '新しい分析'
    && !snapshot.chat?.messages?.length && !snapshot.chat?.input?.trim()
    && !snapshot.results && !snapshot.ai?.explanations?.length && !snapshot.ai?.summary?.trim()
    && !snapshot.population_pyramid
}
