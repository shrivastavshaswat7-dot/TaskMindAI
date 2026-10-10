import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ApiError,
  NETWORK_MESSAGE,
  describeNetworkFailure,
  errorFromResponse,
  messageForStatus,
  readBody,
  timeoutMessage,
  userMessage,
} from './errors.js'

const fakeResponse = (status, body, { json = true } = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => {
    if (!json) throw new SyntaxError('Unexpected token <')
    return body
  },
})

test('the server\'s own message wins when it is plain text', () => {
  assert.equal(messageForStatus(502, 'The AI service failed to analyze the PDFs.'), 'The AI service failed to analyze the PDFs.')
  assert.equal(messageForStatus(429, 'Too many requests. Please wait a moment and try again.'), 'Too many requests. Please wait a moment and try again.')
})

test('status codes without a usable message get a clear default', () => {
  assert.match(messageForStatus(401), /session has expired/)
  assert.match(messageForStatus(403), /do not have access/)
  assert.match(messageForStatus(404), /could not be found/)
  assert.match(messageForStatus(413), /too large/)
  assert.match(messageForStatus(429), /Too many requests/)
  for (const status of [502, 503, 504]) assert.match(messageForStatus(status), /busy or waking up/)
  assert.match(messageForStatus(500), /went wrong on the server/)
  assert.match(messageForStatus(418), /Request failed \(418\)/)
})

test('validation errors (a list) and empty details never show raw', () => {
  assert.match(messageForStatus(422, [{ loc: ['body'], msg: 'field required' }]), /not valid/)
  assert.match(messageForStatus(400, '   '), /not valid/)
})

test('a network failure and a timeout are told apart and readable', () => {
  const network = describeNetworkFailure(new TypeError('Failed to fetch'))
  assert.equal(network.code, 'network')
  assert.equal(network.message, NETWORK_MESSAGE)
  assert.doesNotMatch(network.message, /Failed to fetch/)

  const timeout = describeNetworkFailure(new DOMException('aborted', 'AbortError'), { timedOut: true, timeoutMs: 90000 })
  assert.equal(timeout.code, 'timeout')
  assert.equal(timeout.message, timeoutMessage(90000))
  assert.match(timeout.message, /over 90 seconds/)
})

test('readBody never throws, even for an HTML error page or an empty body', async () => {
  assert.deepEqual(await readBody(fakeResponse(200, { a: 1 })), { a: 1 })
  assert.deepEqual(await readBody(fakeResponse(502, null, { json: false })), {})
  assert.deepEqual(await readBody(fakeResponse(200, null)), {})
})

test('errorFromResponse builds an ApiError from the status and the body', async () => {
  const withDetail = await errorFromResponse(fakeResponse(502, { detail: 'The AI service failed to analyze the PDFs.' }))
  assert.ok(withDetail instanceof ApiError)
  assert.equal(withDetail.status, 502)
  assert.equal(withDetail.message, 'The AI service failed to analyze the PDFs.')

  const proxyPage = await errorFromResponse(fakeResponse(502, null, { json: false }))     // e.g. an HTML page from a proxy
  assert.match(proxyPage.message, /busy or waking up/)
})

test('userMessage always returns text', () => {
  assert.equal(userMessage(new Error('boom')), 'boom')
  assert.match(userMessage(null), /Something went wrong/)
  assert.match(userMessage({}), /Something went wrong/)
})
