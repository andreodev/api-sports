#!/bin/sh
npx eslint '{src,apps,libs,test}/**/*.ts' > /tmp/casino-lint.log 2>&1
status=$?
tail -n 12 /tmp/casino-lint.log
exit "$status"
