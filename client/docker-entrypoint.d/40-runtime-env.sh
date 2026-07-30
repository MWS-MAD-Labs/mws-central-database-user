#!/bin/sh
set -eu

js_escape() {
  printf '%s' "$1" | sed \
    -e 's/\\/\\\\/g' \
    -e "s/'/\\\\'/g"
}

runtime_api_base_url="${VITE_API_BASE_URL:-${API_BASE_URL:-}}"
runtime_google_client_id="${VITE_GOOGLE_CLIENT_ID:-${GOOGLE_CLIENT_ID:-}}"
runtime_google_redirect_uri="${VITE_GOOGLE_REDIRECT_URI:-${CLIENT_URL:-}}"

cat > /usr/share/nginx/html/env.js <<EOF
window.__MWS_ENV__ = {
  VITE_API_BASE_URL: '$(js_escape "$runtime_api_base_url")',
  VITE_GOOGLE_CLIENT_ID: '$(js_escape "$runtime_google_client_id")',
  VITE_GOOGLE_REDIRECT_URI: '$(js_escape "$runtime_google_redirect_uri")',
};
EOF
