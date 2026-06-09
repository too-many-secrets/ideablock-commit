#!/usr/bin/env node

const path = require('path')
const crypto = require('crypto')
const shell = require('shelljs')
const fs = require('fs-extra')
const async = require('async')
const fetch = require('node-fetch')
const os = require('os')
const Table = require('cli-table2')
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

function getParity () {
  return Math.floor(Math.random() * Math.floor(10))
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
        const nowSecs = Math.floor(Date.now() / 1000)
        if (obj.token_expires && obj.token_expires <= nowSecs) {
          // Token expired — clear it and bail gracefully
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
    callback(null, repoHash, commitMessage, shortHash, apiToken)
  })
  s.on('error', callback)
}

// 6. Stamp on Bitcoin via timeglue, sync to backend, display results
function sendOut (repoHash, commitMessage, shortHash, apiToken, callback) {
  const parity = getParity()
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
  fetch(glueURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiToken
    },
    body: JSON.stringify({ hash: repoHash })
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
              }
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
