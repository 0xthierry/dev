export PATH="$HOME/bin:$HOME/.local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:$PATH"
export PATH="$HOME/.cargo/bin:$PATH"
export PATH="$HOME/.local/share/mise/shims:$PATH"
export PATH="$HOME/.opencode/bin:$PATH"
export PATH="/opt/rocm/bin:$PATH"
# Omarchy owns /usr/bin/omarchy-* and resolves dev-link overrides itself.
# macOS and other non-Omarchy hosts keep the shared paths above.
if [[ -r /usr/share/omarchy/default/bash/env-bootstrap ]]; then
  source /usr/share/omarchy/default/bash/env-bootstrap
fi
