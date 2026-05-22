# excalidraw-session

Always-on Pi bridge for Thierry's local Excalidraw instance.

The extension starts a local WebSocket bridge on `127.0.0.1:19275` and exposes one model tool, `excalidraw_canvas`, for the currently focused `http://excalidraw.localhost/` / `http://exacalidraw.localhost/` browser tab.

## Command

- `/excalidraw` or `/excalidraw status` — show bridge status and connected tabs.

## Tool

`excalidraw_canvas` actions:

- `status`
- `get_scene`
- `capture_view`
- `update_scene`
- `add_elements`
- `add_files`
- `scroll_to_content`

`capture_view` returns a PNG of the current visible Excalidraw canvas viewport, not browser UI chrome.

Recommended model workflow:

1. Use `status` when diagnosing connection issues.
2. Use `capture_view` when the visual layout matters.
3. Use `get_scene` before edits to find IDs and coordinates.
4. Use `get_scene` with `elementIds` when exact JSON for nearby elements is needed to clone style/bindings.
5. Use `add_elements` for ordinary additions; it appends to the current canvas.
6. Use `update_scene` only for deliberate whole-scene replacement or appState/files updates. If `elements` is supplied to `update_scene`, it is the complete replacement element list.
