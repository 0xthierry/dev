# Let Ghostty/apps own terminal titles instead of Oh My Zsh prompt hooks.
DISABLE_AUTO_TITLE=true

autoload -Uz add-zsh-hook
add-zsh-hook -d precmd omz_termsupport_precmd 2>/dev/null || true
add-zsh-hook -d preexec omz_termsupport_preexec 2>/dev/null || true

spaceship_ip() {
  local ip=""

  if command -v ip >/dev/null 2>&1; then
    ip="$(ip route get 1 2>/dev/null | awk '{print $7; exit}')"
  elif command -v ifconfig >/dev/null 2>&1; then
    ip="$(ifconfig | awk '/inet / && $2 != "127.0.0.1" {print $2; exit}')"
  fi

  [[ -z "$ip" ]] && return
  spaceship::section --color "blue" --prefix "(" --suffix ") " "$ip"
}

SPACESHIP_PROMPT_ORDER=(
  user
  dir
  host
  ip
  git
  node
  python
  golang
  rust
  docker
  exec_time
  line_sep
  char
)

SPACESHIP_USER_SHOW=always
SPACESHIP_HOST_SHOW=always
SPACESHIP_HOST_PREFIX="at "
SPACESHIP_GIT_SHOW=true
SPACESHIP_GIT_ASYNC=false
SPACESHIP_GIT_STATUS_SHOW=true
SPACESHIP_DIR_TRUNC=3
SPACESHIP_DIR_TRUNC_REPO=false

if [[ -f "${HOME}/.oh-my-zsh/custom/themes/spaceship-prompt/spaceship.zsh-theme" ]]; then
  source "${HOME}/.oh-my-zsh/custom/themes/spaceship-prompt/spaceship.zsh-theme"
fi
