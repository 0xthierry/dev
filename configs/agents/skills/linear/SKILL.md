---
name: linear
description: "Use for Linear issues/projects: create, update, query, comment, attach files, or inspect Linear URLs/tickets."
---

# Using Linear

Manage Linear issues, projects, cycles, teams, labels, and documents using the `linear` CLI.

## Authentication

The CLI uses credentials managed via `linear auth`. If auth fails, ask the user to run `linear auth`.

## Quick Reference

### Issues

```bash
linear issue list                          # List your assigned issues
linear issue view ENG-123                  # View issue details
linear issue create                        # Create issue (interactive)
linear issue update ENG-123                # Update issue
linear issue start ENG-123                 # Start working on issue
linear issue url ENG-123                   # Print issue URL
linear issue title ENG-123                 # Print issue title
linear issue describe ENG-123              # Print title + Linear-issue trailer
linear issue comment                       # Manage comments
linear issue attach ENG-123 ./file.png     # Attach file to issue
linear issue pr ENG-123                    # Create GitHub PR with issue details
linear issue delete ENG-123                # Delete issue
linear issue relation                      # Manage issue relations
linear issue id                            # Print issue from current git branch
```

### Projects

```bash
linear project list                        # List projects
linear project view <projectId>            # View project details
linear project create                      # Create project
linear project update <projectId>          # Update project
linear project delete <projectId>          # Delete project
```

### Project Updates

```bash
linear project-update                      # Manage project status updates
```

### Cycles

```bash
linear cycle list                          # List cycles for a team
linear cycle view <cycleRef>               # View cycle details
```

### Teams

```bash
linear team list                           # List teams
linear team members [teamKey]              # List team members
linear team id                             # Print configured team id
linear team create                         # Create team
linear team delete <teamKey>               # Delete team
linear team autolinks                      # Configure GitHub autolinks
```

### Labels

```bash
linear label list                          # List labels
linear label create                        # Create label
linear label delete <nameOrId>             # Delete label
```

### Documents

```bash
linear document list                       # List documents
linear document view <id>                  # View document content
linear document create                     # Create document
linear document update <documentId>        # Update document
linear document delete [documentId]        # Delete document
```

### Other

```bash
linear api [query]                         # Raw GraphQL API request
linear config                              # Generate .linear.toml configuration
linear schema                              # Print GraphQL schema
```

## Workspace Targeting

Use `-w <slug>` on any command to target a specific workspace:

```bash
linear -w mycompany issue list
```

## Common Patterns

### Get issue from current branch
```bash
linear issue id                            # Returns issue ID from branch name
linear issue view $(linear issue id)       # View details for current branch's issue
```

### Create issue with all fields
```bash
linear issue create --title "Bug: login fails" --team ENG --priority urgent --label bug
```

### Update issue status
```bash
linear issue update ENG-123 --state "In Progress"
```

## Error Handling

| Error | Solution |
|-------|----------|
| "Not authenticated" | Run `linear auth` |
| "Issue not found" | Check issue ID format (e.g., `ENG-123`) |
| "Team not found" | Run `linear team list` to see available teams |
