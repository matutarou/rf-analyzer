// 保存を直列化し、通信中の変更も最後まで書き込む。
export class WorkspaceWriter {
  constructor(persist, version = 0, onStatus = () => {}) {
    this.persist = persist
    this.version = version
    this.onStatus = onStatus
    this.latest = null
    this.saved = null
    this.running = null
  }
  update(snapshot) {
    this.latest = JSON.stringify(snapshot)
  }
  get dirty() { return this.latest !== this.saved }
  flush() {
    if (this.running) return this.running
    this.running = this.drain().finally(() => { this.running = null })
    return this.running
  }
  async drain() {
    while (this.dirty) {
      const payload = this.latest
      this.onStatus('saving')
      try {
        const response = await this.persist({ ...JSON.parse(payload), expected_version: this.version })
        this.version = response.version
        this.saved = payload
      } catch (error) {
        this.onStatus('error', error)
        throw error
      }
    }
    this.onStatus('saved')
  }
}
