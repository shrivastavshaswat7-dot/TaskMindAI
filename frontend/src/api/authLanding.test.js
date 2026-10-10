import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeferred, waitForSettled } from './authLanding.js'

test('waitForSettled resolves at once when nothing is pending', async () => {
  const started = Date.now()
  await waitForSettled(null, 5000)
  await waitForSettled(undefined, 5000)
  assert.ok(Date.now() - started < 500)
})

test('waitForSettled waits for the pending sign-out, not for the limit', async () => {
  const pending = createDeferred()
  let finished = false
  const waiting = waitForSettled(pending.promise, 5000).then(() => {
    finished = true
  })
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(finished, false)                       // still pending: the login must keep waiting
  const started = Date.now()
  pending.resolve()
  await waiting
  assert.equal(finished, true)
  assert.ok(Date.now() - started < 500)               // released as soon as it settled, long before the 5 s limit
})

test('waitForSettled gives up after the limit when the sign-out never answers (login is never blocked forever)', async () => {
  const started = Date.now()
  await waitForSettled(createDeferred().promise, 80)
  const elapsed = Date.now() - started
  assert.ok(elapsed >= 70 && elapsed < 1000, `waited ${elapsed} ms`)
})

test('waitForSettled also continues when the pending call fails', async () => {
  await waitForSettled(Promise.reject(new Error('network')), 5000)   // must not throw into the login
})
