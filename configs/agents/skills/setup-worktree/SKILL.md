---
name: setup-worktree
description: facilitate pre-implementation setups for worktree setup
disable_model_invocation: true
---

## steps to follow


### Step 1 Get required information

1. Figure out what task you're working on 

1a. if you have a ticket number, but no task directory in `ai_docs/tasks/`, find the task dir and refetch the ticket file:

```
Bash(ls ai_docs/tasks | grep eng-XXXX)
```

2. once you have a task dir, fetch the ticket file

```
Bash(linear issue view eng-XXXX > ai_docs/tasks/eng-XXXX-description/ticket.md)
```

3. then read it

```
Read(ai_docs/tasks/eng-XXXX-description/ticket.md)
```


### Step 2 create worktree for implementation

check for a create_worktree.sh script:

```
Bash(ls scripts/create_worktree.sh)
```

if it is present, use the script: 

You will need to know:
1. BRANCHNAME - the branch name (from the ticket)

```
Bash(./scripts/create_worktree.sh BRANCHNAME)
```

The script will handle all setup of .env, etc.

if there is no script, do step 2b instead:

### Step 2b Set up worktree (if no script)

If no script was found use the collected info to create a worktree.

You will need to know:
1. BRANCHNAME - the branch name (from the ticket)
2. DIRNAME - the directory name for the worktree - this is the branch name without the leading `username/`, e.g.
    `fred/eng-1234-fix-ui` -> `eng-1234-fix-ui`
3. REPONAME - the current directory name
4. WORKTREES_BASE - the worktree base directory. If not specified, use `~/wt` as default
5. SETUP_COMMAND - the command to use to set up the repo - (e.g. npm install, bun run setup, etc)

Ask the user if you are missing any of this information, and have them confirm it before proceeding.

<example_confirmation>
I'm ready to create a worktree:
BRANCHNAME: ...
DIRNAME: ...
REPONAME: ...
WORKTREES_BASE: ...
SETUP_COMMAND: UNKNOWN 

If you need any setup like `npm install` let me know and I can include it.

Then I will create worktree at [WORKTREES_BASE/REPONAME/DIRNAME] with

```
git worktree add -b [BRANCHNAME] [WORKTREES_BASE/REPONAME/DIRNAME]
cp .env* WORKTREE_PATH/ 2>/dev/null || true
cp .claude/settings.local.json WORKTREE_PATH/.claude/
[optional setup command here]
```

Let me know if you're ready or want to change anything.
</example_confirmation>

```
Bash(git worktree add -b BRANCHNAME WORKTREES_BASE/REPONAME/DIRNAME)
```

e.g.

```
Bash(git worktree add -b fred/eng-1234-fix-ui ~/wt/webapp/eng-1234-fix-ui)
```

Then, copy the relevant files into the worktree

```
Bash(for f in .env*; do [ -f "$f" ] && cp "$f" WORKTREE_PATH/; done)
Bash(cp .claude/settings.local.json WORKTREE_PATH/.claude/)
Bash(cd WORKTREE_PATH && make setup) # optional, might be npm install, or something else
```

### Step 3 present next steps to the user

<output_example>
Worktree for ENG-XXXX has been configured. You can start implementation by running

```text
use the implement-plan skill for task ai_docs/tasks/eng-xxxx-description
```

in the WORKTREE_PATH directory

</output_example>
