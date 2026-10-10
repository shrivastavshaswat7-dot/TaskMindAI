import test from 'node:test'
import assert from 'node:assert/strict'
import { createSseParser } from './sse.js'

test('complete events in one chunk are all returned in order', () => {
  const parser = createSseParser()
  const events = parser.push('data: {"chunk": "Hel"}\n\ndata: {"chunk": "lo"}\n\ndata: {"done": true}\n\n')
  assert.deepEqual(events, [{ chunk: 'Hel' }, { chunk: 'lo' }, { done: true }])
})

test('a line split across two network chunks is not lost', () => {
  const parser = createSseParser()
  assert.deepEqual(parser.push('data: {"chunk": "Lapl'), [])                 // half a line: nothing yet
  assert.deepEqual(parser.push('ace transform"}\n\ndata: {"chu'), [{ chunk: 'Laplace transform' }])
  assert.deepEqual(parser.push('nk": "!"}\n'), [{ chunk: '!' }])
})

test('an error event from the server is delivered (not swallowed)', () => {
  const parser = createSseParser()
  assert.deepEqual(parser.push('data: {"error": "The AI request failed. Please try again."}\n\n'), [
    { error: 'The AI request failed. Please try again.' },
  ])
})

test('windows line endings, blank lines, comments and junk are ignored safely', () => {
  const parser = createSseParser()
  const events = parser.push(': keep-alive\r\n\r\ndata: {"chunk": "a"}\r\nevent: x\r\ndata: not json\r\ndata:\r\n')
  assert.deepEqual(events, [{ chunk: 'a' }])
})

test('a final line without a trailing newline is returned by flush()', () => {
  const parser = createSseParser()
  assert.deepEqual(parser.push('data: {"done": true}'), [])
  assert.deepEqual(parser.flush(), [{ done: true }])
  assert.deepEqual(parser.flush(), [])                                       // nothing is returned twice
})
