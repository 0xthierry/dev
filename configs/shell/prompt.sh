ZSH_THEME_TERM_TAB_TITLE_IDLE="%1~ - %15<..<%~%<<"
ZSH_THEME_TERM_TITLE_IDLE="%1~ - %n@%m:%~"

function omz_termsupport_preexec {
  [[ "${DISABLE_AUTO_TITLE:-}" != true ]] || return 0

  emulate -L zsh
  setopt extended_glob

  local -a cmdargs
  local job_id=""
  local jobspec=""
  local CMD=""
  local LINE=""
  local FOLDER=""

  cmdargs=("${(z)2}")
  if [[ "${cmdargs[1]}" == fg ]]; then
    jobspec="${cmdargs[2]#%}"
    case "$jobspec" in
      <->) job_id="${jobspec}" ;;
      ""|%|+) job_id="${(k)jobstates[(r)*:+:*]}" ;;
      -) job_id="${(k)jobstates[(r)*:-:*]}" ;;
      [?]*) job_id="${(k)jobtexts[(r)*${(Q)jobspec}*]}" ;;
      *) job_id="${(k)jobtexts[(r)${(Q)jobspec}*]}" ;;
    esac
    if [[ -n "${jobtexts[$job_id]}" ]]; then
      1="${jobtexts[$job_id]}"
      2="${jobtexts[$job_id]}"
    fi
  fi

  CMD="${1[(wr)^(*=*|sudo|ssh|mosh|rake|-*)]:gs/%/%%}"
  LINE="${2:gs/%/%%}"
  FOLDER="${PWD##*/}"

  if typeset -f title >/dev/null 2>&1; then
    title "${FOLDER} - ${CMD}" "${FOLDER} - %100>...>${LINE}%<<"
  fi
}

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
