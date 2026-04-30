# GitHub PR Attachments

Use this reference when screenshots or videos should appear in a GitHub PR or issue without being committed to the repository.

## Rules

- Do not commit media unless the user explicitly asks.
- Upload media through GitHub so it becomes a `github.com/user-attachments/assets/...` URL.
- Clear any draft comment used only for uploading.
- Verify the uploaded media renders in GitHub after updating the PR/issue body.

## Browser Upload Flow

Open the PR or issue:

```bash
agent-browser open https://github.com/<owner>/<repo>/pull/<number>
agent-browser wait --load networkidle
agent-browser snapshot -i
```

Find the comment textarea and file input:

```bash
agent-browser eval '([...document.querySelectorAll("input[type=file], textarea")].map((e,i)=>({i, tag:e.tagName, type:e.type, id:e.id, name:e.getAttribute("name"), aria:e.getAttribute("aria-label"), placeholder:e.getAttribute("placeholder")})))'
```

Upload to the hidden file input. Common GitHub selectors include `#fc-new_comment_field` for the new comment box:

```bash
agent-browser upload '#fc-new_comment_field' /absolute/path/to/proof.png
agent-browser wait 6000
```

Extract the generated markdown from the comment textarea:

```bash
agent-browser eval 'document.querySelector("#new_comment_field")?.value'
```

Expected image markdown usually looks like:

```html
<img width="610" height="430" alt="after-fix" src="https://github.com/user-attachments/assets/<id>" />
```

For videos, GitHub may insert a plain attachment URL.

## Clear Draft Comment

If the upload was only used to generate an attachment URL, clear the comment box:

```bash
agent-browser eval '(() => { const t = document.querySelector("#new_comment_field"); if (t) { t.value = ""; t.dispatchEvent(new Event("input", { bubbles: true })); t.dispatchEvent(new Event("change", { bubbles: true })); } return t?.value ?? null })()'
```

Do not click the comment button unless the user asked for a comment.

## Update PR Body

Use the GitHub CLI when available:

```bash
gh pr view <number> --json body --jq .body > /tmp/pr-body.md
# edit /tmp/pr-body.md with the new attachment URL
gh pr edit <number> --body-file /tmp/pr-body.md
```

Preserve existing useful context, verification commands, and before/after media. Replace only the stale or incorrect attachment URL unless the user asks for a rewrite.

## Verify Rendering

Reload the PR/issue and check the media rendered:

```bash
agent-browser reload
agent-browser wait --load networkidle
agent-browser eval '([...document.images].map(img => ({ src: img.src, complete: img.complete, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, alt: img.alt })))'
```

For a target image, require:

- `complete: true`
- `naturalWidth > 0`
- `naturalHeight > 0`
- expected `alt` or URL id

For video, check the video element:

```bash
agent-browser eval '([...document.querySelectorAll("video")].map(v => ({ src: v.currentSrc || v.src, readyState: v.readyState, videoWidth: v.videoWidth, videoHeight: v.videoHeight })))'
```

`readyState >= 2` usually means enough data loaded to prove the attachment is playable.

## Common Failure Modes

- Upload command succeeds but the textarea remains empty: retry with an absolute file path or click the visible "Paste, drop, or click to add files" control after setting the file input.
- GitHub shows a private `private-user-images.githubusercontent.com` URL after rendering: this is normal for the rendered image; keep the stable `github.com/user-attachments/assets/...` URL in markdown.
- The PR body points to an old attachment: use `gh pr view` to confirm the body contains the new URL and not the old one.
- The image renders but does not prove the fix: create a focused crop and replace it.
