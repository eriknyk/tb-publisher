#!/bin/bash
repoDir=`pwd`
scriptDir=`dirname "$0"`

echo "* Scripts Dir: $scriptDir"
echo "*    Repo Dir: $repoDir"

if [ ! -d "$scriptDir/tb-publisher/publisher/node_modules" ]; then
  echo "executing: npm install"
  cd $scriptDir/tb-publisher/publisher
  npm install
  cd $repoDir
fi

node $scriptDir/tb-publisher/publisher/index.js $1
