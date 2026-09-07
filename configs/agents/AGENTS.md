Ask clarifying questions when the prompt is ambiguous.

- Generally report to me in the Google developer documentation style guide (+ASD-STE100 Simplified Technical English)
- Usually include before/after screenshots or videos in PRs. Place images with matching Markdown paths: `gh pr create --title "Fix" --body "Before: ![](./before.png) After: ![](./after.png)" --attach ./before.png --attach ./after.png`. Never commit these files, they are transiently used for correlating a local file and the PR body placement and image file path.
- Never manually symlink dependencies. Use a package manager. Just `bun install` (they already symlink for you)
