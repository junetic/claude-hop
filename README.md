```
(\ /)
(^.^)  claude hop | chop
```

# Claude Hop — session hopping for Claude Code

Jump between Claude Code sessions across all projects. Instantly.

Built for when you have multiple active Claude sessions across projects and need to switch without losing your place.

Unlike `claude --resume`, this works across all projects from anywhere.

Think of it like tmux for Claude sessions.

https://github.com/user-attachments/assets/a16d8252-65ba-4879-a9aa-c08a9884b7be

```
$ chop

   1  works/claude-hop-cli (2h ago)       › Debug CLI command installation issue
   2  usercall-mcp (2h ago)   › Create webflow template connected to CMS
   3  works/claude-seo-agent (3h ago)   › Review latest seo analysis
   4  app/usercall (1d ago)   › Continue most recent thread
   5  usercall-research-triggers (8d)   › Run user interview at drop-off

resume› 2
→ opening works/usercall-kw-finder...
```

## Install

```bash
npm install -g claude-hop-cli
```

Requires [Claude Code](https://claude.ai/code).

## Commands

| Command           | Description                        |
| ----------------- | ---------------------------------- |
| `chop`            | Pick a session across all projects |
| `chop r`          | Resume most recent session from any project or directory        |
| `chop <name>`     | Jump to a pinned project           |
| `chop pin <name>` | Save current project               |
| `chop ls`         | List pins                          |

## Why

Claude Code sessions are tied to directories.

That means:

- you have to remember where a session lives
- `claude --resume` only works in the right folder
- switching projects is slow and easy to mess up

`chop` lets you jump into any session from anywhere.

## License

MIT
