#≈
<p align="center">
  <img src="https://i.ibb.co/gLBZHSgr/IB-commit.png"/>
</p>

# ideablock-commit — Setup & Development Guide

Automatically tethers every `git commit` to the Bitcoin blockchain using [Ideablock](https://ideablock.com) services.

---

## Prerequisites

- An [Ideablock](https://app.ideablock.com) account (for authentication)

## Install globally

```bash
# From this repo root
npm install
npm install -g .
```

Verify:

```bash
ideablock-commit --help
```

---

## Initialize in a git repo

From the root of any git repository:

```bash
ideablock-commit init
```

This will:
1. Prompt for your Ideablock email and password (first time only)
2. Cache your auth token at `~/.ideablock/auth.json`
3. Install a `post-commit` git hook that fires `ideablock-commit run` on every commit
4. Create a `.ideablock/` config directory in the repo

---

## How it works

On every `git commit`, the hook automatically:

1. Reads your auth token from `~/.ideablock/auth.json`
2. Gets the git short hash of the new commit (e.g. `f99a94c`)
3. Gets the commit message
4. Archives the repo via `git archive` → `~/.ideablock/commits/{repo}/{hash}/Commit-{hash}.zip`
5. SHA-256s the archive → **Repository Hash**
6. Generates a random **Parity Digit** (0–9)
7. Constructs the **Bitcoin-Tethered Hash**: `shortHash + repoHash + parityDigit`
8. POSTs the Repository Hash to timeglue → receives a Bitcoin transaction ID
9. Saves a `commitData.json` record locally at `~/.ideablock/commits/{repo}/{hash}/`
10. Best-effort syncs the record to the Ideablock backend for webapp display
11. Prints the commit information table to your terminal

---

## Local data

All commit records are stored at:

```
~/.ideablock/commits/{repoName}/{gitShortHash}/
  Commit-{shortHash}.zip   ← snapshot of the repo at commit time
  commitData.json          ← all hash and blockchain data
```

**Do not delete this directory.** It is your local proof-of-existence archive.

`commitData.json` structure:

```json
{
  "repoName": "my-project",
  "shortHash": "f99a94c",
  "commitMessage": "fix: update auth flow",
  "repoHash": "c9c3ad5b...",
  "parityDigit": 5,
  "blockchainTetheredHash": "f99a94cc9c3ad5b...5",
  "btcTxID": "a9369cd8...",
  "committedAt": "2026-05-18T12:00:00.000Z"
}
```

---

## Commands

```bash
ideablock-commit init      # Initialize in a git repo (installs hook, prompts login)
ideablock-commit on        # Resume tethering in this repo
ideablock-commit off       # Pause tethering in this repo
ideablock-commit status    # Check whether tethering is on or off
ideablock-commit remove    # Remove hook and .ideablock config from this repo
```

---

## Verify a stamp on-chain

After a commit, look up the Bitcoin transaction ID on
[mempool.space](https://mempool.space):

```
https://mempool.space/tx/{btcTxID}
```

The OP_RETURN output will contain the Ideablock prefix followed by the
Repository Hash — permanent, public proof that your code existed at that
block height.

---

## Troubleshooting


**"Not authenticated. Run ideablock-commit init"**
Your `~/.ideablock/auth.json` is missing. Run `ideablock-commit init` in any
git repo to re-authenticate.  If you do not have a registered account, obtain one by [registering] (https://app.ideablock.com/register)
