# Inline images in Claude Code

Shows images read by Claude, image results from MCP tools, pasted images, and local Markdown image references directly in the terminal transcript. The caption can collapse the preview or open the original in the default image viewer. Merely creating a file does not display it: Claude must read it, return it as an image, or reference its absolute path as a Markdown image.

## Source and updates

Vendored from [alexjsp/claude-inline-images](https://github.com/alexjsp/claude-inline-images), version 0.1.0, commit `cb86e9e627fe78052596ab984d52798a5c16aeb5` (MIT).

`hooks/register.tsx`, `hooks/hooks.json`, `.claude-plugin/plugin.json`, and `LICENSE` are unchanged upstream files. This README and `tests/` belong to the setup repository. To update, review the upstream change, replace those four files from one pinned commit, update this reference, and rerun the checks below. No floating marketplace download occurs during setup.

## Setup

`./setup.sh <host>` installs `inline-images@thierry-local` through `install/claude-inline-images.sh`. The shared Claude settings enable it. The shell config enables `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` for Ghostty or Herdr, while preserving an explicit override such as `0`. Other terminals are not forced. Herdr's shared configuration already has `experimental.kitty_graphics = true`.

Requires Claude Code 2.1.294+ and a terminal that supports Kitty graphics. macOS conversion uses built-in `sips`, `base64`, and `perl`. Linux uses ImageMagick from the shared package list; upstream currently describes Linux as untested. No additional Ghostty graphics switch is required.

Open a new shell after setup. For an existing shell, run `export CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` before starting Claude. Resume an existing conversation with `claude --continue` if desired. `/reload-plugins` reloads the plugin in an active Claude session, but cannot import environment changes from its parent shell.

The plugin runs local conversion processes and caches images in a private temporary folder. It does not add a cloud service. The original image files are left unchanged.

## Validation

```sh
python3 tests/claude-inline-images.test.py
python3 tests/terminal-images.test.py
claude plugin validate configs/agents/claude/plugins/inline-images
claude plugin test configs/agents/claude/plugins/inline-images
```

The mod tests use Claude's real hook/test engine with fixture tool output and stubbed process calls. They verify the resulting `Image` element, not Ghostty's pixels.

For visual acceptance, repeat in **both** a plain Ghostty shell and a Herdr pane inside Ghostty:

1. Start a fresh Claude session with the plugin enabled.
2. Ask it to read a known PNG, then a JPEG. The picture must appear below the tool call, not only `[image ...]` text.
3. Paste an image and check the preview beneath your prompt.
4. Scroll away and back, resize the terminal, and check that the preview remains aligned.

Do not claim end-to-end rendering based only on plugin validation, tests, or the graphics environment variable. SSH/remote Herdr rendering and unsupported outer terminals require separate verification.
