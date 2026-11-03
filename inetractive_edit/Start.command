#!/bin/zsh
cd "${0:A:h}" || exit 1
if [[ ! -d node_modules ]]; then
  npm ci || exit 1
fi
npm start