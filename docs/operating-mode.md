# Operating Mode

This repo is managed for continuity across machines and agent sessions.

## Source of truth

Git is the source of truth. Chat history and folder sync are useful context, but durable project state belongs in tracked files and commits.

## Start of session

1. Inspect `git status --short --branch`.
2. Review recent commits with `git log --oneline -5`.
3. Read `README.md` if present.
4. Read roadmap, architecture, session-note, and decision docs when present.
5. Report the current repo state briefly before changing files.

## During work

- Keep line endings cross-platform safe; prefer LF for repo text files.
- Prefer WSL2 notes for Windows development when relevant.
- Capture durable context in tracked docs, not only in chat.
- Use short decision records for important choices.
- Keep `docs/session-notes/current.md` updated with current focus, last good state, next steps, and blockers.
- Commit completed units of work with clear messages.
- Never put secrets in Git.

## End of session

1. Update session notes if project state changed.
2. Run validation/checks that fit the change.
3. Commit useful changes unless explicitly told not to.
4. Report the commit hash and the next best step.

## Original bootstrap prompt

```text
You are at the helm of this repo with me. Please make this project manageable across multiple machines and agent sessions.

Adopt this operating mode:

- Git is the source of truth, not chat history and not folder sync.
- Before doing work, inspect `git status --short --branch`, recent commits, and the project docs.
- If the repo does not already have them, add:
  - `.editorconfig`
  - `.gitattributes`
  - `docs/operating-mode.md`
  - `docs/session-notes/current.md`
  - `docs/decisions/README.md`
- Keep line endings cross-platform safe, preferably LF for repo text files.
- Prefer WSL2 for Windows development notes when relevant.
- Capture durable context in tracked docs, not only in the chat.
- Use short decision records for important choices.
- Keep `docs/session-notes/current.md` updated with current focus, last good state, next steps, and blockers.
- Commit completed units of work with clear messages.
- Never put secrets in Git.

When you start:

1. Read `README.md` if it exists.
2. Read any roadmap, architecture, session-note, or decision docs.
3. Report the current repo state briefly.
4. Continue the work from the tracked context.

When you finish:

1. Update session notes if the project state changed.
2. Run validation/checks that fit the change.
3. Commit useful changes unless I explicitly ask you not to.
4. Tell me the commit hash and the next best step.
```
