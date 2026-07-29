#!/bin/sh
set -eu

js_escape() {
  printf '%s' "$1" | sed \
    -e 's/\\/\\\\/g' \
    -e "s/'/\\\\'/g"
}

cat > /usr/share/nginx/html/env.js <<EOF
window.__MWS_ENV__ = {
  VITE_API_BASE_URL: '$(js_escape "${VITE_API_BASE_URL:-}")',
  VITE_GOOGLE_CLIENT_ID: '$(js_escape "${VITE_GOOGLE_CLIENT_ID:-}")',
  VITE_GOOGLE_REDIRECT_URI: '$(js_escape "${VITE_GOOGLE_REDIRECT_URI:-}")',
};
EOF
