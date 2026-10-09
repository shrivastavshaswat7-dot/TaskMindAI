import test from 'node:test'
import assert from 'node:assert/strict'
import { withApiBase } from './apiBase.js'

test('withApiBase leaves relative URLs alone when no base is configured (local dev proxy)', () => {
  assert.equal(withApiBase('/api/quiz', ''), '/api/quiz')
})

test('withApiBase prefixes the backend URL and handles a trailing slash', () => {
  assert.equal(withApiBase('/api/quiz', 'https://api.example.com'), 'https://api.example.com/api/quiz')
})

test('withApiBase does not touch absolute URLs', () => {
  assert.equal(withApiBase('https://other.example.com/x', 'https://api.example.com'), 'https://other.example.com/x')
})
