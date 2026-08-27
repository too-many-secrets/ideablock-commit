// Hook installation and .gitignore handling.
//
// Both used to shell out to `echo ... >> file`. That failed completely on
// Windows, where cmd.exe's echo neither interprets \n nor strips quotes, and
// it duplicated its own output on a second run everywhere else. These tests
// exist because both failures were silent: the file was written, it just did
// not say what anyone intended.
//
// node:test — no dependency, runs on any Node 18+.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs-extra')
const os = require('os')
const path = require('path')

// The functions are module-private, so lift them out of the source rather than
// exporting them purely for the test. Keeps the module's surface honest.
function lift (name) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'init.js'), 'utf8')
  const body = src.slice(src.indexOf('function ' + name))
  let depth = 0
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '{') depth++
    else if (body[i] === '}' && --depth === 0) {
      const consts = "const HOOK_SHEBANG = '#!/bin/sh'\nconst HOOK_COMMAND = 'ideablock-commit run'\n"
      // eslint-disable-next-line no-eval
      return eval(`(function(){const fs=require('fs-extra'),path=require('path');${consts}${body.slice(0, i + 1)};return ${name}})()`)
    }
  }
  throw new Error('could not lift ' + name)
}

const installPostCommitHook = lift('installPostCommitHook')
const addIgnoreLine = lift('addIgnoreLine')

function tmpdir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ibc-hook-'))
}

test('writes a runnable hook into an empty file', async () => {
  const hook = path.join(tmpdir(), 'post-commit')
  await installPostCommitHook(hook)
  const body = fs.readFileSync(hook, 'utf8')
  assert.strictEqual(body, '#!/bin/sh\nideablock-commit run\n')
  // The literal cmd.exe used to produce, verbatim.
  assert.ok(!body.includes('\\n'), 'must not contain a literal backslash-n')
  assert.ok(!body.includes('"'), 'must not contain quotes')
})

test('is idempotent — three inits do not anchor three times', async () => {
  const hook = path.join(tmpdir(), 'post-commit')
  await installPostCommitHook(hook)
  await installPostCommitHook(hook)
  await installPostCommitHook(hook)
  const lines = fs.readFileSync(hook, 'utf8').split('\n').filter((l) => l.trim() === 'ideablock-commit run')
  assert.strictEqual(lines.length, 1)
})

test("preserves a hook the user already had", async () => {
  const hook = path.join(tmpdir(), 'post-commit')
  const theirs = '#!/usr/bin/env bash\nnpm run lint\n'
  fs.writeFileSync(hook, theirs)
  await installPostCommitHook(hook)
  const body = fs.readFileSync(hook, 'utf8')
  assert.ok(body.startsWith(theirs), 'their script must survive intact')
  assert.ok(body.endsWith('ideablock-commit run\n'))
  // A second shebang injected mid-file would break their hook.
  assert.strictEqual(body.split('\n').filter((l) => l.startsWith('#!')).length, 1)
})

test('repairs a file with no trailing newline', async () => {
  const hook = path.join(tmpdir(), 'post-commit')
  fs.writeFileSync(hook, '#!/bin/sh\necho hi')
  await installPostCommitHook(hook)
  const body = fs.readFileSync(hook, 'utf8')
  assert.ok(body.includes('echo hi\nideablock-commit run\n'), 'must not join onto the previous line')
})

test('uses LF, never CRLF — git refuses a CRLF shebang', async () => {
  const hook = path.join(tmpdir(), 'post-commit')
  await installPostCommitHook(hook)
  assert.ok(!fs.readFileSync(hook, 'utf8').includes('\r'))
})

test('gitignore keeps existing rules and adds ours once', async () => {
  const dir = tmpdir()
  const gi = path.join(dir, '.gitignore')
  fs.writeFileSync(gi, 'node_modules/\n.env\n*.log')
  const cwd = process.cwd()
  process.chdir(dir)
  try {
    await new Promise((res) => addIgnoreLine(res))
    await new Promise((res) => addIgnoreLine(res))
  } finally {
    process.chdir(cwd)
  }
  const body = fs.readFileSync(gi, 'utf8')
  // The truncation bug: .env being un-ignored is how a secret gets committed.
  assert.ok(body.includes('.env'), 'existing rules must survive')
  assert.ok(body.includes('node_modules/'))
  assert.strictEqual(body.split('\n').filter((l) => l.trim() === '.ideablock').length, 1)
})
