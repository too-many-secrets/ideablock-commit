#!/usr/bin/env node
const path = require('path')
const fs = require('fs-extra')
const shell = require('shelljs')
const async = require('async')
const chalk = require('chalk')
const f = require('./helpers.js')
const os = require('os')
const figlet = require('figlet')
const fetch = require('node-fetch')
const inquirer = require('inquirer')

const ideablockAPIURL = process.env.IDEABLOCK_API_URL || 'http://localhost:3000'
const repoName = path.basename(process.cwd())
const contents = '"#!/bin/bash\nideablock-commit run "'
const authFilePath = path.join(os.homedir(), '.ideablock', 'auth.json')
const repoSaveDir = path.join(os.homedir(), '.ideablock', 'commits', repoName)
const contentsConf = 'echo ' + contents + '>> ' + path.join(process.cwd(), '.ideablock', 'post-commit')
const contentsHooks = 'echo ' + contents + '>> ' + path.join(process.cwd(), '.git', 'hooks', 'post-commit')
const log = console.log

let jsonAuthContents = {}

const loginQuestions = [
  {
    type: 'input',
    name: 'email',
    message: 'Email: '
  },
  {
    type: 'password',
    name: 'password',
    mask: '*',
    message: 'Password: '
  }
]

function addIgnoreLine (callback) {
  fs.ensureFile(path.join(process.cwd(), '.gitignore'))
    .then(() => {
      shell.exec('> .gitignore && echo "\n.ideablock" >> .gitignore', { silent: true }, function (code, out, err) {
        callback(null)
      })
    })
}

function createDotIdeaBlock (callback) {
  fs.ensureFile(path.join(process.cwd(), '.ideablock', 'ideablock.json'))
    .then(() => fs.writeJson(path.join(process.cwd(), '.ideablock', 'ideablock.json'), { on: true }))
    .then(() => fs.ensureFile(path.join(process.cwd(), '.ideablock', 'post-commit')))
    .then(() => {
      shell.exec(contentsConf, function (c, o, e) {
        fs.chmodSync(path.join(process.cwd(), '.ideablock', 'post-commit'), 0o744)
        callback(null)
      })
    })
    .catch((err) => log(err))
}

const createHook = function (err, results) {
  if (err) log(err)
  fs.ensureFile(path.join(process.cwd(), '.git', 'hooks', 'post-commit'))
    .then(() => {
      shell.exec(contentsHooks, function (c, o, e) {
        fs.chmodSync(path.join(process.cwd(), '.git', 'hooks', 'post-commit'), 0o744)
        log(chalk.green.bold('\n\t✅ IdeaBlock Commit has been initialized for the git repository in the current directory.\n'))
        process.exit(0)
      })
    })
    .catch((err) => log(err))
}

function banner () {
  log('\n')
  log(chalk.bold.rgb(255, 216, 100)('    ____    __           __    __           __      ________    ____  '))
  log(chalk.bold.rgb(255, 216, 100)('   /  _/___/ /__  ____ _/ /_  / /___  _____/ /__   / ____/ /   /  _/ '))
  log(chalk.bold.rgb(255, 216, 100)('   / // __  / _ \\/ __ `/ __ \\/ / __ \\/ ___/ //_/  / /   / /    / /   '))
  log(chalk.bold.rgb(255, 216, 100)(' _/ // /_/ /  __/ /_/ / /_/ / / /_/ / /__/ ,<    / /___/ /____/ /    '))
  log(chalk.bold.rgb(255, 216, 100)('/___/\\__,_/\\___/\\__,_/_.___/_/\\____/\\___/_/|_|   \\____/_____/___/    '))
  log('\n')
  log(chalk.bold.white('Please login with your Ideablock credentials.'))
  log(chalk.gray('(You can sign up at https://ideablock.io)\n'))
}

function authorize () {
  fs.ensureDirSync(repoSaveDir)

  // Check if a valid (non-expired) token already exists
  const authExists = fs.pathExistsSync(authFilePath)
  if (authExists) {
    try {
      const existing = fs.readJsonSync(authFilePath)
      const nowSecs = Math.floor(Date.now() / 1000)
      if (existing.token && existing.token_expires && existing.token_expires > nowSecs) {
        // Token is still valid — skip login
        jsonAuthContents = existing
        setup()
        return
      } else {
        log(chalk.yellow('\n\t⚠️  Your Ideablock session has expired. Please log in again.\n'))
        fs.removeSync(authFilePath)
      }
    } catch (e) {
      fs.removeSync(authFilePath)
    }
  }

  // Prompt for credentials
  inquirer.prompt(loginQuestions)
    .then(answers => {
      fetch(ideablockAPIURL + '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: answers.email, password: answers.password })
      })
        .then(res => {
          if (res.status === 401 || res.status === 403 || res.status === 500) {
            log(chalk.red('\n\t❌ We cannot find an Ideablock account with those credentials.'))
            log(chalk.red('\t   Please visit https://ideablock.io to register.\n'))
            process.exit(0)
          } else if (res.status === 200) {
            res.json()
              .then(obj => {
                // Store token + user info — no raw password ever touches disk
                jsonAuthContents = {
                  token: obj.token,
                  token_expires: obj.token_expires,
                  user: {
                    id: obj.user.id,
                    email: obj.user.email,
                    first_name: obj.user.first_name,
                    last_name: obj.user.last_name
                  },
                  cached_at: Math.floor(Date.now() / 1000)
                }
                fs.ensureFile(authFilePath)
                  .then(() => fs.writeJson(authFilePath, jsonAuthContents))
                  .then(() => {
                    log(chalk.green('\n\t✅ Logged in as ' + obj.user.email + '\n'))
                    setup()
                  })
                  .catch((err) => log(err))
              })
              .catch(() => {
                log(chalk.red('\n\t❌ Unexpected response from Ideablock. Please try again.\n'))
                process.exit(0)
              })
          } else {
            log(chalk.red('\n\t❌ Login failed (status ' + res.status + '). Please try again.\n'))
            process.exit(0)
          }
        })
        .catch(err => {
          log(chalk.red('\n\t❌ Could not reach Ideablock API: ' + err.message))
          log(chalk.red('\t   Is the backend running? Set IDEABLOCK_API_URL if needed.\n'))
          process.exit(0)
        })
    })
}

function setup () {
  if (!f.isRepo()) {
    log('\n\t❗ ' + chalk.bold('The present directory is not a git repository.'))
    log('\t   Please initialize a git repository in this directory before invoking ideablock-commit.\n')
  } else if ((f.isRepo() && !f.exists(path.join(process.cwd(), '.ideablock')))) {
    async.series([addIgnoreLine, createDotIdeaBlock], createHook)
  } else if (f.isRepo() && f.isOn()) {
    log(chalk.green.bold('\n\t✅ IdeaBlock Commit is initialized for the git repository in the current directory.\n'))
  } else if (f.isRepo() && f.isOff()) {
    createHook()
    fs.writeJsonSync(path.join(process.cwd(), '.ideablock', 'ideablock.json'), { on: true })
  }
}

module.exports.init = function () {
  if (!f.authed()) {
    banner()
    authorize()
  } else {
    // Even if auth file exists, verify token hasn't expired
    try {
      const existing = fs.readJsonSync(authFilePath)
      const nowSecs = Math.floor(Date.now() / 1000)
      if (existing.token_expires && existing.token_expires <= nowSecs) {
        log(chalk.yellow('\n\t⚠️  Your Ideablock session has expired. Please log in again.\n'))
        fs.removeSync(authFilePath)
        banner()
        authorize()
        return
      }
    } catch (e) {
      fs.removeSync(authFilePath)
      banner()
      authorize()
      return
    }
    setup()
  }
}
