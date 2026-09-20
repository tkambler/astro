import { test } from 'node:test'
import assert from 'node:assert/strict'
import { notePreview } from '../src/notes/content/index.ts'

test('sidebar preview starts after leading YAML frontmatter', () => {
  assert.equal(notePreview('---\ntitle: Example\ntags: [work]\n---\n\n# Visible body'), 'Visible body')
  assert.equal(notePreview('\uFEFF---\r\ntitle: Example\r\n---\r\nBody'), 'Body')
})

test('sidebar preview keeps text without a complete leading frontmatter block', () => {
  assert.equal(notePreview('First line\n---\ntitle: Later\n---'), 'First line\n---\ntitle: Later\n---')
  assert.equal(notePreview('---\ntitle: Open\nBody'), '---\ntitle: Open\nBody')
  assert.equal(notePreview('---\ntitle: Empty\n---\n'), 'Empty note')
})
