#!/bin/sh
# Makes the agent CLIs listed in ARC_AGENTS (comma-separated: claude, copilot, cursor,
# antigravity) available in ~/.local, then starts the application. An already available CLI is
# kept unless ARC_AGENTS_UPDATE=true. It also downloads the speech-to-text model when
# STT_PROVIDER is whisper-cpp.

install_agent() {
  binary="$1"
  shift
  if [ "$ARC_AGENTS_UPDATE" != "true" ] && command -v "$binary" >/dev/null 2>&1; then
    return
  fi
  echo "[entrypoint] Installing $binary"
  if ! "$@"; then
    echo "[entrypoint] Failed to install $binary, continuing without it" >&2
  fi
}

for agent in $(echo "$ARC_AGENTS" | tr ',' ' '); do
  case "$agent" in
    claude) install_agent claude sh -c 'ln -sf /app/node_modules/@anthropic-ai/claude-agent-sdk-linux-*/claude "$HOME/.local/bin/claude"' ;;
    copilot) install_agent copilot npm install --global @github/copilot ;;
    cursor) install_agent cursor-agent sh -c 'curl -fsSL https://cursor.com/install | bash' ;;
    antigravity) install_agent agy sh -c 'curl -fsSL https://antigravity.google/cli/install.sh | bash' ;;
    *) echo "[entrypoint] Unknown agent '$agent' in ARC_AGENTS" >&2 ;;
  esac
done

# Downloads the whisper.cpp model used for audio transcription when it is not available yet.
if [ "${STT_PROVIDER:-whisper-cpp}" = "whisper-cpp" ] && [ -z "$STT_MODEL_PATH" ]; then
  model="${STT_MODEL:-small}"
  model_file="${DATA_DIR:-/app/data}/models/ggml-$model.bin"
  if [ ! -f "$model_file" ]; then
    echo "[entrypoint] Downloading the whisper.cpp model '$model'"
    mkdir -p "$(dirname "$model_file")"
    if ! curl -fsSL -o "$model_file.part" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$model.bin" \
      || ! mv "$model_file.part" "$model_file"; then
      rm -f "$model_file.part"
      echo "[entrypoint] Failed to download the model, audio will be sent to the agent as an attachment" >&2
    fi
  fi
fi

exec "$@"
