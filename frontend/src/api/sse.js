// Parser for the chat endpoint's Server-Sent Events stream (lines like `data: {"chunk": "..."}`).
// Network chunks do not respect line boundaries: a `data:` line can arrive in two pieces, so the incomplete tail is kept
// until the rest arrives (the previous code split every chunk on its own and silently dropped such lines).
export function createSseParser() {
  let buffer = ''

  const parseLine = (line) => {
    const trimmed = line.replace(/\r$/, '')
    if (!trimmed.startsWith('data:')) return null
    const payload = trimmed.slice(5).trim()
    if (!payload) return null
    try {
      return JSON.parse(payload)
    } catch {
      return null          // not a complete JSON event: ignored, never thrown
    }
  }

  return {
    // Feed decoded text; returns the complete events found so far
    push(text) {
      buffer += text
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      return lines.map(parseLine).filter(Boolean)
    },
    // End of stream: whatever is left in the buffer is a final line without a trailing newline
    flush() {
      const rest = buffer
      buffer = ''
      const event = parseLine(rest)
      return event ? [event] : []
    },
  }
}
