#!/bin/bash
# Starts the fake Apps Script server, runs the browser tests, then stops the server.
cd "$(dirname "$0")"
node ui-server.js > /tmp/little-ui-server.log 2>&1 & PID=$!
sleep 1
node ui-test.js && node iframe-test.js; STATUS=$?
kill $PID
exit $STATUS
