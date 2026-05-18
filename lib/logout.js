#!/usr/bin/env node
const path = require('path')
const fs = require('fs-extra')
const chalk = require('chalk')
const os = require('os')

const authFilePath = path.join(os.homedir(), '.ideablock', 'auth.json')
const log = console.log

module.exports.logout = function () {
  fs.pathExists(authFilePath, (err, exists) => {
    if (err) return log(chalk.red('\n\t❌ Error checking auth file: ' + err.message + '\n'))
    if (!exists) {
      log(chalk.yellow('\n\t⚠️  You are not currently logged in.\n'))
      return
    }
    fs.remove(authFilePath, (err) => {
      if (err) return log(chalk.red('\n\t❌ Could not remove auth file: ' + err.message + '\n'))
      log(chalk.green('\n\t✅ Logged out. Run "ideablock-commit init" in a git repo to log in again.\n'))
    })
  })
}
