# Working with GitHub

GitHub is the shared source of truth. A local folder is still used while editing, but it is a working copy rather than a hand-maintained version archive. Commits record changes, tags mark versions, and GitHub Releases hold installable userscripts.

## Everyday workflow

1. Open the repository folder in Codex.
2. Synchronize before starting with `git pull --ff-only`.
3. Ask Codex to make and verify the change.
4. Review the changed files and test results.
5. Commit and push the finished change to GitHub.

For this personal repository, small verified changes may go directly to `main`. Use a short-lived branch and pull request for experimental or risky work.

## Releasing

1. Update canonical code under `src/` and tests under `tests/`.
2. Add `release-notes/<version>.md`.
3. Run the project release command described in [releasing](releasing.md).
4. Commit and push the release commit.
5. Push the matching version tag. GitHub verifies and publishes both `.user.js` assets automatically.

Do not create another local version folder. Git history preserves the source, `archive/releases/` preserves release snapshots, and GitHub Releases provide downloads.

## macOS setup

Install GitHub CLI with `brew install gh`, then run `gh auth login --hostname github.com --git-protocol https --web` and `gh auth setup-git`. Store active projects somewhere stable such as `~/Developer/`; cloning is preferable to copying a previously downloaded folder.

## Windows setup

Install Git for Windows and GitHub CLI with `winget install --id Git.Git -e` and `winget install --id GitHub.cli -e`. Restart the terminal, then run `gh auth login --hostname github.com --git-protocol https --web` and `gh auth setup-git`. Clone into a normal development folder such as `%USERPROFILE%\source\repos`; avoid cloud-synced folders for active repositories.

## Moving between computers

Commit and push on the first computer, then pull on the second. Never synchronize an active repository by copying its folder through iCloud, OneDrive, Dropbox, USB, or email. If a computer has no local copy yet, clone it from GitHub once.

Useful checks:

```sh
git status
git pull --ff-only
git log --oneline -5
```

If `git status` shows unfinished changes, commit, discard, or deliberately preserve them before pulling. Do not force-push or rewrite a published tag unless correcting a confirmed release emergency.
