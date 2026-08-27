#!/usr/bin/env node
const path = require('path')
const chalk = require('chalk')
const f = require('./helpers.js')
const confFile = path.join(process.cwd(), '.ideablock', 'ideablock.json')
const confHook = path.join(process.cwd(), '.ideablock', 'post-commit')
const log = console.log

module.exports.status = function () {
  if (!(f.exists(confFile) && f.exists(confHook))) {
    log(chalk.bold('\n\t❗ Ideablock Commit is currently ') + chalk.bold.rgb(242, 24, 0)('UNINITIALIZED') + chalk.bold(' in this directory.\nPlease run the "init" function in this directory to initialize Ideablock Commit.\n'))
  } else if (!f.isRepo()) {
    log('\n\t❗ Ideablock Commit: The current directory is not a git repository.')
    log('\t   Please initialize a git repository in the present directory or change to the root of a git repository.\n')
  } else if (f.isRepo() && f.isOn()) {
    log('\n\tIdeablock Commit is currently ' + chalk.bold.green('INITIALIZED ') + 'and ' + chalk.bold.green('ON') + ' in this repository.\n')
  } else if (f.isRepo() && f.isOff()) {
    log('\n\tIdeablock Commit is currently ' + chalk.bold.green('INITIALIZED ') + 'and ' + chalk.bold.rgb(242, 24, 0)('OFF') + ' in this repository.\n')
  }
}
