#!/usr/bin/env node
const path = require('path')
const fs = require('fs-extra')
const chalk = require('chalk')
const os = require('os')
const fetch = require('node-fetch')

const authFilePath = path.join(os.homedir(), '.ideablock', 'auth.json')
const ideablockAPIURL = process.env.IDEABLOCK_API_URL || 'https://app.ideablock.com'
const log = console.log

// Logging out revokes the token server-side, then removes it locally.
//
// Deleting the file alone used to be enough because the stored credential
// expired on its own within fifteen minutes. A CLI token does not expire — it
// ends when it is revoked — so a local-only logout would leave a working
// credential behind forever, and "I logged out" would be false.
module.exports.logout = function () {
  fs.pathExists(authFilePath, (err, exists) => {
    if (err) return log(chalk.red('\n\t❌ Error checking auth file: ' + err.message + '\n'))
    if (!exists) {
      log(chalk.yellow('\n\t⚠️  You are not currently logged in.\n'))
      return
    }

    let token = null
    try {
      token = (fs.readJsonSync(authFilePath) || {}).token
    } catch (e) { /* unreadable file: still remove it below */ }

    const removeLocal = (note) => {
      fs.remove(authFilePath, (rmErr) => {
        if (rmErr) return log(chalk.red('\n\t❌ Could not remove auth file: ' + rmErr.message + '\n'))
        log(chalk.green('\n\t✅ Logged out.' + (note || '') + ' Run "ideablock-commit init" in a git repo to log in again.\n'))
      })
    }

    if (!token || !String(token).startsWith('ibk_')) {
      // A legacy session token expires by itself; nothing to revoke.
      return removeLocal('')
    }

    fetch(ideablockAPIURL + '/api/cli/token/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }
    })
      .then((res) => {
        if (res.ok) return removeLocal(' Token revoked.')
        // Be explicit rather than silently leaving a live credential: the user
        // needs to know to revoke it from Settings.
        log(chalk.yellow('\n\t⚠️  Could not revoke the token on the server (HTTP ' + res.status + ').'))
        log(chalk.yellow('\t   Revoke it from Settings in the web app so it cannot be reused.\n'))
        removeLocal('')
      })
      .catch((e) => {
        log(chalk.yellow('\n\t⚠️  Could not reach Ideablock to revoke the token: ' + e.message))
        log(chalk.yellow('\t   Revoke it from Settings in the web app so it cannot be reused.\n'))
        removeLocal('')
      })
  })
}
