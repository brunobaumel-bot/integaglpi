#!/usr/bin/env sh
set -eu

echo "Bootstrapping integration-service dependencies..."
cd "$(dirname "$0")/../integration-service"
npm install

echo "Bootstrapping ai-service dependencies..."
cd ../ai-service
npm install

if command -v composer >/dev/null 2>&1; then
  echo "Bootstrapping integaglpi dependencies..."
  cd ../integaglpi
  composer install
fi
