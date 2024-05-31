#!/bin/bash
if [ ! -d "publisher/node_modules" ]; then
  echo "executing: npm install"
  cd publisher/
  npm install
  cd ../
fi

node publisher/index.js $1
