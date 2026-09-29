<p align="center">
  <img src="https://raw.githubusercontent.com/too-many-secrets/ideablock-commit/master/assets/ib-commit.png" alt="Ideablock Commit"/>
</p>

# Prove when you wrote it

Tethers every `git commit` to the Bitcoin blockchain — automatically, in the
background, without your code ever leaving your machine.

```bash
npm install -g ideablock-commit
```

## Why

Git proves the *order* of your commits. It does not prove *when* they happened.
A date in git is whatever the committer's clock said, author dates can be set
to anything, and history can be rewritten and force-pushed.

That is fine until it matters: a contractor claims they brought the idea in, a
competitor ships something you built first, or you need to show prior art
before a filing. At that point "it's in our repo" is your word against theirs,
and the repo is yours to change.

This writes a fingerprint of each commit into a Bitcoin transaction. The
block's timestamp becomes the latest moment that code can have existed, and
anyone can verify it — without your permission, without your repository, and
without Ideablock. We cannot alter it either, which is the point.

Your code never leaves your machine. What goes on chain is a SHA-256 of the
archive, not the archive.

---

## Clients

Two supported clients, and both anchor an identical value:

| Client | Install | Needs |
|---|---|---|
| **Node CLI** | `npm install -g ideablock-commit` | Node 18+ |
| **Go binary** | [download a release](https://github.com/too-many-secrets/ideablock-commit/releases) | nothing — single static binary |

The Go binary exists for people who would rather not install Node. Either
produces the same on-chain record for the same commit.

`ports/` holds implementations in seven further languages — Rust, Python, PHP,
Java, C, C++, and plain Node. **They are reference implementations, not
supported clients.** They document that the hashing and anchoring format can be
reproduced anywhere, which matters for a record meant to be independently
verifiable. They are not built, released, or kept in step release-to-release,
and they authenticate with a session token that expires after fifteen minutes,
which makes them unsuitable for a hook that runs unattended. Read them; do not
depend on them.

## Prerequisites

- An [Ideablock](https://app.ideablock.com) account (for authentication)
- `git` on your `PATH` — the tool shells out to `git archive` and `git log`.
  On Windows that means [Git for Windows](https://git-scm.com/download/win),
  which also provides the shell that runs the commit hook.
- Node 18 or later, for the Node CLI

## Install globally

```bash
npm install -g ideablock-commit
```

Or from a clone:

```bash
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
6. Derives the **Parity Digit**: the hex digits of `shortHash + repoHash`, summed, mod 10
7. Constructs the **Bitcoin-Tethered Hash**: `shortHash + repoHash + parityDigit`
8. POSTs the Bitcoin-Tethered Hash to Ideablock, which anchors it → receives a Bitcoin transaction ID
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

The OP_RETURN output contains the Ideablock prefix (`**IDEA**`) followed by the
**Bitcoin-Tethered Hash** — permanent, public proof that your code existed at
that block height.

### Verifying a stamp yourself

Every character of the anchored value is reproducible from the archive alone.
Given `Commit-{hash}.zip`:

```bash
shortHash=$(git log -1 --pretty=format:%h)
repoHash=$(shasum -a 256 "Commit-${shortHash}.zip" | cut -d' ' -f1)

combined="${shortHash}${repoHash}"
sum=0
for (( i=0; i<${#combined}; i++ )); do
  sum=$(( sum + 16#${combined:i:1} ))
done

echo "${combined}$(( sum % 10 ))"
```

(Requires bash, not sh — it uses bash arithmetic and substring syntax.)

That value should match the OP_RETURN payload after the `**IDEA**` prefix.

### What goes on chain

The OP_RETURN payload is 72 characters, and every one of them is reproducible
from the archive:

```
0e6cd60  180985c0…af96e13  1
└─────┘  └──────────────┘  └┘
short    sha256(archive)   parity
(7)      (64)              (1)
```

Nothing else is published. The archive itself never leaves your machine unless
you upload it deliberately, so the chain carries a fingerprint of your code and
not your code.

---

## Troubleshooting


**"Not authenticated. Run ideablock-commit init"**
Your `~/.ideablock/auth.json` is missing. Run `ideablock-commit init` in any
git repo to re-authenticate.  If you do not have a registered account, obtain one by [registering](https://app.ideablock.com/register)

**"Not recorded to Ideablock — you have used all of your protections"**
Your account's allowance is used up. **The commit was still tethered to
Bitcoin and saved locally** — only the copy of the record in your Ideablock
account was declined, so the proof itself is unaffected. A free account covers
three protections in total; paid plans reset monthly. Upgrade at
[app.ideablock.com/settings/plan](https://app.ideablock.com/settings/plan).

**"Not recorded to Ideablock — this organization is read-only"**
The organization's subscription is not active, so it cannot add new records.
As above, **the commit was still tethered to Bitcoin and saved locally**;
everything already in the account stays available to view and download. If you
are not the person who holds the card, this is one for an administrator:
[app.ideablock.com/organization/payment](https://app.ideablock.com/organization/payment).

**The commit table printed, but nothing appears on the Commits page**
The anchor and the web record are two separate steps, deliberately: the
Bitcoin transaction happens first and the record sync is best-effort, so a
backend problem can never cost you an anchor. If the table printed a
`Bitcoin Hash`, the proof exists — check the two messages above, which are the
usual reasons the record was declined rather than lost.
