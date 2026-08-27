#!/usr/bin/env node

const path = require('path')
const crypto = require('crypto')
const shell = require('shelljs')
const fs = require('fs-extra')
const async = require('async')
const fetch = require('node-fetch')
const FormData = require('form-data')
const os = require('os')
const Table = require('cli-table3')
const chalk = require('chalk')
const Ora = require('ora')
const f = require('./helpers.js')

// Everything anchoring-related lives behind Ideablock's cloud backend. The
// CLI never talks to timeglue or the wallet directly — only to authenticated
// endpoints on app.ideablock.com.
const ideablockAPIURL = process.env.IDEABLOCK_API_URL || 'https://app.ideablock.com'
const glueURL = ideablockAPIURL + '/api/commit-ideas/glue'

const log = console.log
let jsonAuthContents = {}
const repoName = path.basename(process.cwd())
const repoSaveDir = path.join(os.homedir(), '.ideablock', 'commits', repoName)
const desiredMode = 0o2775
const spinUp = {
  interval: 150,
  frames: [
    '🖥️ 💡------------------------------⛓️',
    '🖥️ -💡-----------------------------⛓️',
    '🖥️ --💡----------------------------⛓️',
    '🖥️ ---💡---------------------------⛓️',
    '🖥️ ----💡--------------------------⛓️',
    '🖥️ -----💡-------------------------⛓️',
    '🖥️ ------💡------------------------⛓️',
    '🖥️ -------💡-----------------------⛓️',
    '🖥️ --------💡----------------------⛓️',
    '🖥️ ---------💡---------------------⛓️',
    '🖥️ ----------💡--------------------⛓️',
    '🖥️ -----------💡-------------------⛓️',
    '🖥️ ------------💡------------------⛓️',
    '🖥️ -------------💡-----------------⛓️',
    '🖥️ --------------💡----------------⛓️',
    '🖥️ ---------------💡---------------⛓️',
    '🖥️ ----------------💡--------------⛓️',
    '🖥️ -----------------💡-------------⛓️',
    '🖥️ ------------------💡------------⛓️',
    '🖥️ -------------------💡-----------⛓️',
    '🖥️ --------------------💡----------⛓️',
    '🖥️ ---------------------💡---------⛓️',
    '🖥️ ----------------------💡--------⛓️',
    '🖥️ -----------------------💡-------⛓️',
    '🖥️ ------------------------💡------⛓️',
    '🖥️ -------------------------💡-----⛓️',
    '🖥️ --------------------------💡----⛓️',
    '🖥️ ---------------------------💡---⛓️',
    '🖥️ ----------------------------💡--⛓️',
    '🖥️ -----------------------------💡-⛓️',
    '🖥️ ------------------------------💡⛓️',
    '🖥️ --------------------------------💡',
    '🖥️ --------------------------------💡',
    '🖥️ --------------------------------💡',
    '🖥️ --------------------------------💡',
    '🖥️ --------------------------------💡',
    '🖥️ --------------------------------💡'
  ]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// The parity digit, derived from the value it accompanies.
//
// It used to be Math.random(). That had two costs, both quiet. The backend
// dedups anchors on the exact hash it is handed, so a random digit meant the
// same tree produced a different value on every run, the dedup never matched,
// and a second Bitcoin transaction was broadcast at a real fee. And a verifier
// holding the archive could rebuild 71 of the 72 characters and had to take
// the last one on faith — in a product whose whole claim is a record nobody
// has to take on faith.
//
// Derived, it is reproducible by anyone with the archive: sum the hex digits
// of the short hash and the archive digest, mod 10. It stays one character, so
// the on-chain payload keeps its 72-character shape and its even length, which
// timeglue requires — it hex-decodes the payload before building the OP_RETURN,
// and an odd-length string fails there rather than here.
function deriveParity (shortHash, repoHash) {
  const digits = (shortHash + repoHash).toLowerCase()
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    const v = parseInt(digits[i], 16)
    if (!isNaN(v)) sum += v
  }
  return sum % 10
}

// ── Async waterfall steps ─────────────────────────────────────────────────────

// 1. Load auth from ~/.ideablock/auth.json, check expiry
function authorize (callback) {
  fs.pathExists(path.join(os.homedir(), '.ideablock', 'auth.json'), (err, exists) => {
    if (err) return callback(err)
    if (!exists) {
      return callback(new Error('Not authenticated. Run "ideablock-commit init" to log in.'))
    }
    fs.readJson(path.join(os.homedir(), '.ideablock', 'auth.json'))
      .then((obj) => {
        jsonAuthContents = obj
        // A CLI token (ibk_...) does not expire; it ends when revoked. Only a
        // legacy session token stored by an older version carries an expiry,
        // and that is what made every repo ask for a login every 15 minutes.
        const nowSecs = Math.floor(Date.now() / 1000)
        const isCLIToken = obj.token && String(obj.token).startsWith('ibk_')
        if (!isCLIToken && obj.token_expires && obj.token_expires <= nowSecs) {
          fs.removeSync(path.join(os.homedir(), '.ideablock', 'auth.json'))
          return callback(new Error('Your Ideablock session has expired. Run "ideablock-commit init" to log in again.'))
        }
        // Support both new format (token) and old format (auth) gracefully
        const apiToken = obj.token || obj.auth
        callback(null, apiToken)
      })
      .catch(callback)
  })
}

// 2. Get git short hash of the current HEAD commit
function getShortHash (apiToken, callback) {
  shell.exec('git log -1 --pretty=format:%h', { silent: true }, function (code, stdout, stderr) {
    const shortHash = stdout.substring(0, 7)
    callback(null, shortHash, apiToken)
  })
}

// 3. Get the git commit message for the current HEAD commit
function getCommitMessage (shortHash, apiToken, callback) {
  shell.exec('git log -1 --pretty=format:%s', { silent: true }, function (code, stdout, stderr) {
    const commitMessage = stdout.trim()
    callback(null, commitMessage, shortHash, apiToken)
  })
}

// 4. Archive the repo into a zip snapshot
function ideaZip (commitMessage, shortHash, apiToken, callback) {
  const commitSaveDir = path.join(repoSaveDir, shortHash)
  const zipFile = path.join(commitSaveDir, 'Commit-' + shortHash + '.zip')
  fs.ensureDir(commitSaveDir, desiredMode)
    .then(() => {
      shell.exec('git archive -o ' + zipFile + ' HEAD', function (code, stdout, stderr) {
        callback(null, zipFile, commitMessage, shortHash, apiToken)
      })
    })
    .catch(callback)
}

// 5. SHA-256 the zip archive
function hashRepo (zipFile, commitMessage, shortHash, apiToken, callback) {
  const shasum = crypto.createHash('sha256')
  const s = fs.ReadStream(zipFile)
  s.on('data', function (d) { shasum.update(d) })
  s.on('end', function () {
    const repoHash = shasum.digest('hex')
    callback(null, zipFile, repoHash, commitMessage, shortHash, apiToken)
  })
  s.on('error', callback)
}

// 6. Stamp on Bitcoin via timeglue, sync to backend, display results
function sendOut (zipFile, repoHash, commitMessage, shortHash, apiToken, callback) {
  const parity = deriveParity(shortHash, repoHash)
  const spinner = new Ora({ spinner: spinUp, indent: 5 })
  spinner.start('  Tethering Commit to Bitcoin Blockchain')

  const blockchainTetheredHash = shortHash + repoHash + parity
  const committedAt = new Date().toISOString()

  // Derive userID from new auth format (user.id) or fall back gracefully
  const userID = (jsonAuthContents.user && jsonAuthContents.user.id) ||
                 jsonAuthContents.user_id ||
                 jsonAuthContents.userId ||
                 (apiToken ? apiToken.substring(0, 16) : 'unknown')

  // ── Call Ideablock glue proxy (backend forwards to timeglue cloud-side) ──
  // The COMPOSITE goes on chain, not the bare repo hash: git short hash +
  // sha256(archive) + parity digit. That is the value this tool has always
  // built and recorded as blockchainTetheredHash, but the anchor call used to
  // send repoHash, so the short hash and the parity digit never reached the
  // OP_RETURN — the chain carried only the 32-byte archive digest.
  //
  // Every character of it is now reproducible from the archive alone. See
  // deriveParity, and ANCHOR_FORMATS in the README for what earlier stamps
  // look like.
  fetch(glueURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiToken
    },
    body: JSON.stringify({ hash: blockchainTetheredHash })
  })
    .then(res => {
      if (!res.ok) throw new Error('anchor request returned status ' + res.status)
      return res.json()
    })
    .then(glueResult => {
      spinner.stop()
      const btcTxID = glueResult.btcTx

      const commitObj = {
        repoName,
        shortHash,
        commitMessage,
        repoHash,
        parityDigit: parity,
        blockchainTetheredHash,
        btcTxID,
        committedAt
      }

      const commitSaveDir = path.join(repoSaveDir, shortHash)
      const commitDataPath = path.join(commitSaveDir, 'commitData.json')

      // Save local record
      fs.writeJSON(commitDataPath, commitObj)
        .then(() => {
          log('\n\t✅ Congratulations! Your commit has been successfully tethered using Ideablock!\n')

          const table = new Table({ style: { head: [], border: [] } })
          table.push(
            [{ colSpan: 2, content: chalk.bold.rgb(242, 24, 0)('Commit Information:') }],
            [chalk.yellow('Bitcoin Hash:'), btcTxID],
            [chalk.white('Commit Short Hash:'), shortHash],
            [chalk.green('Repository Hash:'), repoHash],
            [chalk.red('Parity Digit'), parity],
            [chalk.cyanBright('Blockchain-Tethered Hash'), blockchainTetheredHash],
            [chalk.blue('Commit Record Location'), commitSaveDir]
          )
          log(table.toString())

          // ── Best-effort sync to Ideablock backend ─────────────────────────
          fetch(ideablockAPIURL + '/api/commit-ideas', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + apiToken
            },
            body: JSON.stringify(commitObj)
          })
            .then(res => {
              if (!res.ok) {
                log(chalk.gray('\n\t⚠️  Could not sync commit record to Ideablock (backend unreachable). Local record saved.\n'))
                return null
              }
              return res.json()
            })
            .then(row => {
              // Backend assigns the row a typed hash ID; use it to attach the
              // zip archive so the /commits page can browse the file tree.
              if (!row || !row.id) return
              const form = new FormData()
              form.append('zip', fs.createReadStream(zipFile))
              return fetch(ideablockAPIURL + '/api/commit-ideas/' + row.id + '/zip', {
                method: 'POST',
                headers: Object.assign({ 'Authorization': 'Bearer ' + apiToken }, form.getHeaders()),
                body: form
              }).then(zres => {
                if (!zres.ok) {
                  log(chalk.gray('\n\t⚠️  Code archive upload failed (status ' + zres.status + '). Anchor is still good; archive can be retried later.\n'))
                }
              })
            })
            .catch(() => {
              log(chalk.gray('\n\t⚠️  Could not sync commit record to Ideablock (backend unreachable). Local record saved.\n'))
            })
            .finally(() => callback(null, '\n'))
        })
        .catch(callback)
    })
    .catch(err => {
      spinner.stop()
      log(chalk.red('\n\t❌ Failed to tether commit to Bitcoin blockchain: ' + err.message))
      log(chalk.red('\t   Check your network connection and that your Ideablock session is still active (run "ideablock-commit init" if needed).\n'))
      callback(null, '\n') // non-fatal — don't block the git commit
    })
}

// ── Entry point ───────────────────────────────────────────────────────────────

module.exports.run = function () {
  if (f.isOn()) {
    async.waterfall([authorize, getShortHash, getCommitMessage, ideaZip, hashRepo, sendOut], function (err, result) {
      if (err) log(chalk.red('\n\t❌ ideablock-commit error: ' + err.message))
      process.exit(0)
    })
  } else {
    log('\n\t❗ ' + chalk.bold('IdeaBlock Commit is currently set to ') + chalk.bold.rgb(242, 24, 0)('OFF') + chalk.bold(' in this repository.'))
    log('\t   Please run "ideablock-commit on" in the root directory of this repository to turn on automatic commit blockchain tethering functionality.')
    process.exit(0)
  }
}
