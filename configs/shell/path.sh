export PATH="$HOME/bin:$HOME/.local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:$PATH"
export PATH="$HOME/.cargo/bin:$PATH"
export PATH="$HOME/.local/share/mise/shims:$PATH"
export PATH="$HOME/.opencode/bin:$PATH"
export PATH="/opt/rocm/bin:$PATH"
# Quattro owns /usr/bin/omarchy-* and resolves dev-link overrides itself.
# Never let an archived 3.x checkout shadow the packaged commands.
if [[ -r /usr/share/omarchy/default/bash/env-bootstrap ]]; then
  # zsh's path array also clears a legacy path inherited from a pre-cutover shell.
  path=("${(@)path:#${HOME}/.local/share/omarchy/bin}")
  source /usr/share/omarchy/default/bash/env-bootstrap
elif [[ -d "$HOME/.local/share/omarchy/bin" ]]; then
  export OMARCHY_PATH="$HOME/.local/share/omarchy"
  export PATH="$OMARCHY_PATH/bin:$PATH"
fi
