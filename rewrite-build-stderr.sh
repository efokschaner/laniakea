#!/bin/sh
# This seemingly unnecessary wrapper file is to solve an issue with node under Windows Git Bash not playing nicely with pipe redirection
# https://stackoverflow.com/questions/45112889/bash-node-js-stdin-stdout-redirection-error-not-a-tty
node rewrite-build-stderr.js
exit $?