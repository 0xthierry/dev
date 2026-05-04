# Pi Comment Extension

Registers `/comment`, a command that opens the last completed assistant response in `$VISUAL` or `$EDITOR` as a quoted Markdown draft. After the editor exits successfully, the edited text is loaded into Pi's input editor.

## Usage

```text
/comment
```

Requirements:

- Run in interactive or RPC mode.
- Set `VISUAL` or `EDITOR` to an editor command that exits when editing is done, such as `nvim`, `vim`, or `code --wait`.
- The current branch must contain a completed assistant message with text content.

The command quotes each assistant line with `> ` before opening the external editor.
