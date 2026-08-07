#!/bin/sh
set -eu
runtime_host="$(printf '%s' "${CLIENT_URL:-}" | sed -E 's#^[a-zA-Z]+://##; s#[:/].*##')"

if [ -n "$runtime_host" ]; then
  sed -i "s/server_name db\.mws\.web\.id localhost;/server_name $runtime_host localhost;/" /etc/nginx/conf.d/default.conf
fi
