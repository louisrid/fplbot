#!/bin/sh
set -eu
mkdir -p src
cat payload/index.b64.* | tr -d '\n' | base64 -d > src/index.js
cat payload/db.b64.* | tr -d '\n' | base64 -d > src/db.js
cat payload/time.b64.* | tr -d '\n' | base64 -d > src/time.js
node --check src/index.js
node --check src/db.js
node --check src/time.js
