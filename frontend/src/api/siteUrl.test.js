import test from 'node:test'
import assert from 'node:assert/strict'
import { authRedirectUrl, normalizeSiteUrl } from './siteUrl.js'

test('local dev (no VITE_SITE_URL) uses the page origin', () => {
  assert.equal(authRedirectUrl('http://localhost:5173', ''), 'http://localhost:5173/')
})

test('production uses the configured site URL even on a Vercel preview/deployment URL', () => {
  assert.equal(
    authRedirectUrl('https://taskmindai-abc123-team.vercel.app', 'https://taskmindai-iota.vercel.app'),
    'https://taskmindai-iota.vercel.app/',
  )
})

test('the redirect always ends in exactly one slash', () => {
  assert.equal(authRedirectUrl('https://x.example.com/', ''), 'https://x.example.com/')
  assert.equal(authRedirectUrl('https://x.example.com', 'https://site.example.com//'), 'https://site.example.com/')
})

test('normalizeSiteUrl trims, strips trailing slashes and adds https:// to a bare host', () => {
  assert.equal(normalizeSiteUrl('  https://site.example.com/// '), 'https://site.example.com')
  assert.equal(normalizeSiteUrl('site.example.com'), 'https://site.example.com')
  assert.equal(normalizeSiteUrl(undefined), '')
})
