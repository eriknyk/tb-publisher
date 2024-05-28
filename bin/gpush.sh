#!/bin/bash
current_branch=`git branch --show-current`
echo "Pushing branch: $current_branch  es->  remotes: [master|upstream]"
git push origin $current_branch
git push upstream $current_branch

exit 0