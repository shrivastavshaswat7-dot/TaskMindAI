import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeApiBase, withApiBase } from './apiBase.js'

test('withApiBase leaves relative URLs alone when no base is configured (local dev proxy)', () => {
  assert.equal(withApiBase('/api/quiz', ''), '/api/quiz')
})

test('withApiBase prefixes the backend URL and handles a trailing slash', () => {
  assert.equal(withApiBase('/api/quiz', 'https://api.example.com'), 'https://api.example.com/api/quiz')
})

test('withApiBase does not touch absolute URLs', () => {
  assert.equal(withApiBase('https://other.example.com/x', 'https://api.example.com'), 'https://other.example.com/x')
})

test('normalizeApiBase adds https:// to a bare host and strips spaces and trailing slashes', () => {
  assert.equal(normalizeApiBase('taskmindai-api.onrender.com'), 'https://taskmindai-api.onrender.com')
  assert.equal(normalizeApiBase('  https://api.example.com//  '), 'https://api.example.com')
  assert.equal(normalizeApiBase('http://localhost:8000'), 'http://localhost:8000')
})

test('normalizeApiBase leaves an unset value empty (local dev proxy)', () => {
  assert.equal(normalizeApiBase(undefined), '')
  assert.equal(normalizeApiBase('   '), '')
})
