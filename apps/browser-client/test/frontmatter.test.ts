import { test } from 'node:test'
import assert from 'node:assert/strict'
import { textNote } from '../src/notes/transfer/frontmatter.ts'

test('frontmatter metadata overrides the filename and preserves the source', () => {
  const body = `---
title: From YAML
tags:
  - work
  - ideas
createdAt: 2021-02-03
updatedAt: 2022-05-06T10:30:00-05:00
---
# Content
`
  assert.deepEqual(textNote('filename.MD', body), {
    title: 'From YAML', body, tags: ['work', 'ideas'],
    createdAt: '2021-02-03T00:00:00.000Z', updatedAt: '2022-05-06T15:30:00.000Z',
  })
})

test('filename and empty tags are used without frontmatter', () => {
  assert.deepEqual(textNote('plain.TXT', 'Just text'),
    { title: 'plain', body: 'Just text', tags: [] })
  const body = 'A horizontal rule follows\n---\ntitle: Not frontmatter\n---\n'
  assert.deepEqual(textNote('plain.md', body), { title: 'plain', body, tags: [] })
})

test('comma-separated tags are accepted and deduplicated', () => {
  assert.deepEqual(textNote('note.md', '---\ntags: work, ideas, work\n---\n'),
    { title: 'note', body: '---\ntags: work, ideas, work\n---\n', tags: ['work', 'ideas'],
      createdAt: undefined, updatedAt: undefined })
})

test('invalid metadata rejects the file', () => {
  assert.throws(() => textNote('bad.md', '---\ntags: [valid, 4]\n---\n'), /tags must be/)
  assert.throws(() => textNote('bad.md', '---\ncreatedAt: not-a-date\n---\n'), /invalid createdAt/)
  assert.throws(() => textNote('bad.md', '---\ntitle: [unfinished\n---\n'), /invalid YAML frontmatter/)
})
