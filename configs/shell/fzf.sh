if [[ -f "${HOME}/.config/dev-setup/fzf.sh" ]]; then
  source "${HOME}/.config/dev-setup/fzf.sh"
fi

if command -v fzf >/dev/null 2>&1; then
  source <(fzf --zsh)
fi
