#!/usr/bin/env bash
set -uo pipefail

# Install all tools required by the cr-* code review agents + LSP servers.
# Supports Linux (Arch, Ubuntu/Debian, Fedora) and macOS.

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

info()  { printf "${GREEN}[✓]${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}[!]${NC} %s\n" "$1"; }
err()   { printf "${RED}[✗]${NC} %s\n" "$1"; }
heading() { printf "\n${BOLD}── %s${NC}\n" "$1"; }

OS="$(uname -s)"
DISTRO=""

detect_distro() {
  if [[ "$OS" == "Darwin" ]]; then
    DISTRO="macos"
  elif [[ -f /etc/os-release ]]; then
    # shellcheck disable=SC1091
    source /etc/os-release
    case "$ID" in
      arch|endeavouros|manjaro|garuda) DISTRO="arch" ;;
      ubuntu|debian|pop|linuxmint)     DISTRO="debian" ;;
      fedora|rhel|centos|rocky|alma)   DISTRO="fedora" ;;
      *)
        if [[ -n "${ID_LIKE:-}" ]]; then
          case "$ID_LIKE" in
            *arch*)   DISTRO="arch" ;;
            *debian*) DISTRO="debian" ;;
            *fedora*|*rhel*) DISTRO="fedora" ;;
          esac
        fi
        ;;
    esac
  fi

  if [[ -z "$DISTRO" ]]; then
    err "Unsupported OS/distro. Detected: $OS"
    exit 1
  fi
}

cmd_exists() { command -v "$1" &>/dev/null; }

# ── Package manager helpers ──────────────────────────────────────────

pkg_install() {
  case "$DISTRO" in
    macos)  brew install "$@" ;;
    arch)   sudo pacman -S --needed --noconfirm "$@" ;;
    debian) sudo apt-get install -y "$@" ;;
    fedora) sudo dnf install -y "$@" ;;
  esac
}

npm_install_global() {
  if cmd_exists npm; then
    npm install -g "$@"
    # asdf requires reshimming after global npm installs
    if cmd_exists asdf; then
      asdf reshim nodejs 2>/dev/null
    fi
  else
    err "npm not found — cannot install $*"
    return 1
  fi
}

# ── Individual installers ────────────────────────────────────────────

install_node() {
  heading "Node.js & npm"
  if cmd_exists node && cmd_exists npm; then
    info "node $(node -v) and npm $(npm -v) already installed"
    return
  fi

  warn "Installing Node.js..."
  case "$DISTRO" in
    macos)  brew install node ;;
    arch)   sudo pacman -S --needed --noconfirm nodejs npm ;;
    debian)
      # Use NodeSource for a recent version
      if ! cmd_exists node; then
        curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
        sudo apt-get install -y nodejs
      fi
      ;;
    fedora) sudo dnf install -y nodejs npm ;;
  esac
  info "node $(node -v) installed"
}

install_ast_grep() {
  heading "ast-grep"
  if cmd_exists ast-grep; then
    info "ast-grep already installed: $(ast-grep --version 2>/dev/null || echo 'unknown version')"
    return
  fi

  warn "Installing ast-grep..."
  case "$DISTRO" in
    macos)  brew install ast-grep ;;
    arch)
      if cmd_exists paru; then
        paru -S --needed --noconfirm ast-grep
      elif cmd_exists yay; then
        yay -S --needed --noconfirm ast-grep
      else
        # Fall back to cargo or npm
        if cmd_exists cargo; then
          cargo install ast-grep
        else
          npm_install_global @ast-grep/cli
        fi
      fi
      ;;
    debian|fedora)
      if cmd_exists cargo; then
        cargo install ast-grep
      else
        npm_install_global @ast-grep/cli
      fi
      ;;
  esac
  info "ast-grep installed"
}

install_graphviz() {
  heading "Graphviz (dot)"
  if cmd_exists dot; then
    info "graphviz already installed: $(dot -V 2>&1 | head -1)"
    return
  fi

  warn "Installing graphviz..."
  case "$DISTRO" in
    macos)  pkg_install graphviz ;;
    arch)   pkg_install graphviz ;;
    debian) pkg_install graphviz ;;
    fedora) pkg_install graphviz ;;
  esac
  info "graphviz installed"
}

install_madge() {
  heading "madge (import graph analyzer)"
  if cmd_exists madge; then
    info "madge already installed: $(madge --version 2>/dev/null)"
    return
  fi

  warn "Installing madge globally..."
  npm_install_global madge
  info "madge installed"
}

install_knip() {
  heading "knip (dead code detector)"
  if cmd_exists knip; then
    info "knip already installed: $(knip --version 2>/dev/null)"
    return
  fi

  warn "Installing knip globally..."
  npm_install_global knip
  info "knip installed"
}

install_typescript_lsp() {
  heading "TypeScript Language Server (LSP)"
  if cmd_exists typescript-language-server; then
    info "typescript-language-server already installed: $(typescript-language-server --version 2>/dev/null)"
    return
  fi

  warn "Installing typescript-language-server globally..."
  npm_install_global typescript-language-server typescript
  info "typescript-language-server installed"
}

install_vscode_langservers() {
  heading "vscode-langservers-extracted (HTML/CSS/JSON LSP)"
  local check_cmd="vscode-json-language-server"
  if cmd_exists "$check_cmd"; then
    info "vscode-langservers already installed"
    return
  fi

  warn "Installing vscode-langservers-extracted..."
  npm_install_global vscode-langservers-extracted
  info "vscode-langservers installed"
}

# ── Additional LSP servers ───────────────────────────────────────────

install_rust_analyzer() {
  heading "rust-analyzer (Rust LSP)"
  if cmd_exists rust-analyzer; then
    info "rust-analyzer already installed: $(rust-analyzer --version 2>/dev/null | head -1)"
    return
  fi

  warn "Installing rust-analyzer..."
  if cmd_exists rustup; then
    rustup component add rust-analyzer
  else
    case "$DISTRO" in
      macos)  brew install rust-analyzer ;;
      arch)   pkg_install rust-analyzer ;;
      debian) pkg_install rust-analyzer ;;
      fedora) pkg_install rust-analyzer ;;
    esac
  fi
  info "rust-analyzer installed"
}

install_gopls() {
  heading "gopls (Go LSP)"
  if cmd_exists gopls; then
    info "gopls already installed: $(gopls version 2>/dev/null | head -1)"
    return
  fi

  warn "Installing gopls..."
  if cmd_exists go; then
    go install golang.org/x/tools/gopls@latest
  else
    case "$DISTRO" in
      macos)  brew install gopls ;;
      arch)   pkg_install gopls ;;
      debian|fedora)
        err "Go not found — install Go first, then run: go install golang.org/x/tools/gopls@latest"
        return 1
        ;;
    esac
  fi
  info "gopls installed"
}

install_pyright() {
  heading "pyright (Python LSP)"
  if cmd_exists pyright; then
    info "pyright already installed: $(pyright --version 2>/dev/null)"
    return
  fi

  warn "Installing pyright..."
  npm_install_global pyright
  info "pyright installed"
}

install_bash_lsp() {
  heading "bash-language-server (Bash/Shell LSP)"
  if cmd_exists bash-language-server; then
    info "bash-language-server already installed: $(bash-language-server --version 2>/dev/null)"
    return
  fi

  warn "Installing bash-language-server..."
  npm_install_global bash-language-server
  info "bash-language-server installed"
}

install_yaml_lsp() {
  heading "yaml-language-server (YAML LSP)"
  if cmd_exists yaml-language-server; then
    info "yaml-language-server already installed: $(yaml-language-server --version 2>/dev/null)"
    return
  fi

  warn "Installing yaml-language-server..."
  npm_install_global yaml-language-server
  info "yaml-language-server installed"
}

install_taplo() {
  heading "taplo (TOML LSP)"
  if cmd_exists taplo; then
    info "taplo already installed: $(taplo --version 2>/dev/null)"
    return
  fi

  warn "Installing taplo..."
  case "$DISTRO" in
    macos)  brew install taplo ;;
    arch|debian|fedora)
      if cmd_exists cargo; then
        cargo install taplo-cli --locked
      else
        npm_install_global @taplo/cli
      fi
      ;;
  esac
  info "taplo installed"
}

install_lua_lsp() {
  heading "lua-language-server (Lua LSP)"
  if cmd_exists lua-language-server; then
    info "lua-language-server already installed"
    return
  fi

  warn "Installing lua-language-server..."
  case "$DISTRO" in
    macos)  brew install lua-language-server ;;
    arch)   pkg_install lua-language-server ;;
    debian)
      warn "lua-language-server not in apt — install from GitHub releases or use brew"
      return 1
      ;;
    fedora)
      warn "lua-language-server not in dnf — install from GitHub releases or use brew"
      return 1
      ;;
  esac
  info "lua-language-server installed"
}

install_clangd() {
  heading "clangd (C/C++ LSP)"
  if cmd_exists clangd; then
    info "clangd already installed: $(clangd --version 2>/dev/null | head -1)"
    return
  fi

  warn "Installing clangd..."
  case "$DISTRO" in
    macos)  brew install llvm ;;
    arch)   pkg_install clang ;;
    debian) pkg_install clangd ;;
    fedora) pkg_install clang-tools-extra ;;
  esac
  info "clangd installed"
}

install_tailwind_lsp() {
  heading "tailwindcss-language-server (Tailwind CSS LSP)"
  if cmd_exists tailwindcss-language-server; then
    info "tailwindcss-language-server already installed"
    return
  fi

  warn "Installing tailwindcss-language-server..."
  npm_install_global @tailwindcss/language-server
  info "tailwindcss-language-server installed"
}

install_dockerfile_lsp() {
  heading "dockerfile-language-server (Dockerfile LSP)"
  if cmd_exists docker-langserver; then
    info "dockerfile-language-server already installed"
    return
  fi

  warn "Installing dockerfile-language-server..."
  npm_install_global dockerfile-language-server-nodejs
  info "dockerfile-language-server installed"
}

install_marksman() {
  heading "marksman (Markdown LSP)"
  if cmd_exists marksman; then
    info "marksman already installed: $(marksman --version 2>/dev/null || echo 'installed')"
    return
  fi

  warn "Installing marksman..."
  case "$DISTRO" in
    macos)  brew install marksman ;;
    arch)
      if cmd_exists paru; then
        paru -S --needed --noconfirm marksman-bin
      elif cmd_exists yay; then
        yay -S --needed --noconfirm marksman-bin
      else
        warn "marksman requires an AUR helper (paru/yay) on Arch"
        return 1
      fi
      ;;
    debian|fedora)
      # Install from GitHub releases
      local arch
      arch="$(uname -m)"
      case "$arch" in
        x86_64)  arch="linux-x64" ;;
        aarch64) arch="linux-arm64" ;;
        *) err "Unsupported architecture: $arch"; return 1 ;;
      esac
      local url="https://github.com/artempyanykh/marksman/releases/latest/download/marksman-${arch}"
      curl -fsSL "$url" -o /usr/local/bin/marksman
      sudo chmod +x /usr/local/bin/marksman
      ;;
  esac
  info "marksman installed"
}

# ── Verification ─────────────────────────────────────────────────────

verify() {
  heading "Verification"
  local all_good=true

  local tools=(
    "node" "npm" "ast-grep" "madge" "knip" "dot" "git"
    "typescript-language-server" "vscode-json-language-server"
    "rust-analyzer" "gopls" "pyright"
    "bash-language-server" "yaml-language-server" "taplo"
    "lua-language-server" "clangd"
    "tailwindcss-language-server" "docker-langserver" "marksman"
  )
  local labels=(
    "Node.js" "npm" "ast-grep" "madge" "knip" "Graphviz" "git"
    "TypeScript LSP" "JSON/HTML/CSS LSP"
    "Rust LSP" "Go LSP" "Python LSP"
    "Bash LSP" "YAML LSP" "TOML LSP"
    "Lua LSP" "C/C++ LSP"
    "Tailwind CSS LSP" "Dockerfile LSP" "Markdown LSP"
  )

  for i in "${!tools[@]}"; do
    if cmd_exists "${tools[$i]}"; then
      info "${labels[$i]} — ${tools[$i]} found"
    else
      err "${labels[$i]} — ${tools[$i]} NOT found"
      all_good=false
    fi
  done

  echo ""
  if $all_good; then
    info "All tools are installed and available."
  else
    warn "Some tools are missing. Check errors above."
  fi
}

# ── Main ─────────────────────────────────────────────────────────────

main() {
  echo ""
  printf "${BOLD}cr-* Agent Tools & LSP Installer${NC}\n"
  echo "Installs: ast-grep, madge, knip, Graphviz, and LSP servers for"
  echo "TypeScript, Rust, Go, Python, Bash, YAML, TOML, Lua, C/C++,"
  echo "Tailwind CSS, Dockerfile, and Markdown."
  echo ""

  detect_distro
  info "Detected: $DISTRO ($OS)"

  # macOS: ensure Homebrew is available
  if [[ "$DISTRO" == "macos" ]] && ! cmd_exists brew; then
    err "Homebrew not found. Install it first: https://brew.sh"
    exit 1
  fi

  # Core tools
  install_node
  install_ast_grep
  install_graphviz
  install_madge
  install_knip

  # LSP servers
  install_typescript_lsp
  install_vscode_langservers
  install_rust_analyzer
  install_gopls
  install_pyright
  install_bash_lsp
  install_yaml_lsp
  install_taplo
  install_lua_lsp
  install_clangd
  install_tailwind_lsp
  install_dockerfile_lsp
  install_marksman

  verify
}

main "$@"
