import fs from 'fs';
import path from 'path';
import { spawn } from 'node:child_process';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

import { Octokit } from '@octokit/rest';

const OWNER = 'towbook';
const REPO = 'towbook-android';
const getClient = () => new Octokit({ auth: process.env.GH_TOKEN });

async function composeReleaseBody(issueNumber, pullNumber) {
  const issue = await getIssue(issueNumber);
  const commits = await getPullRequestCommits(pullNumber);

  const commitsText = commits.map(x => `- ${x.commitId} ${x.message}`).join('\n');

  let body = `## Issue
[#${issueNumber}](https://github.com/${OWNER}/${REPO}/issues/${issueNumber}) ${issue.title}

## Changes
${commitsText}
`

  return body;
}

async function getIssue(issueNumber) {
  const octokit = getClient();
  const res = await octokit.rest.issues.get({
    owner: OWNER,
    repo: REPO,
    issue_number: issueNumber
  });

  return res.data;
}

async function getPullRequestCommits(pullNumber) {
  const octokit = getClient();
  const res = await octokit.rest.pulls.listCommits({
    owner: OWNER,
    repo: REPO,
    pull_number: pullNumber,
  });

  return res.data
    .filter(x => {
      if (x.commit.message.startsWith('Update build version'))
        return false;
      if (x.commit.message.startsWith('Merge remote-tracking'))
        return false;

      return true;
    })
    .map(x => ({
      commitId: x.sha,
      message: x.commit.message
    }));
}

async function createRelease(versionName, buildNumber, prerelease, issueNumber, pullNumber) {
  const octokit = getClient();

  const tag = `${versionName}-${buildNumber}`;
  const body = await composeReleaseBody(issueNumber, pullNumber);
  const releaseName = `Build ${tag}`

  const res = await octokit.rest.repos.createRelease({
    owner: OWNER,
    repo: REPO,
    tag_name: tag,
    target_commitish: 'release',
    name: releaseName,
    body: body,
    draft: false,
    prerelease: prerelease,
    generate_release_notes: false
  })

  return res.data;
}

async function uploadReleaseAsset(releaseId, filePath, fileName) {
  const octokit = getClient();
  const fileContent = fs.readFileSync(filePath);
  const fileStats = fs.statSync(filePath);

  const response = await octokit.rest.repos.uploadReleaseAsset({
    owner: OWNER,
    repo: REPO,
    release_id: releaseId,
    name: fileName,
    data: fileContent,
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': fileStats.size,
    }
  });

  return response.data.browser_download_url;
};

async function getRelease(releaseId) {
  const octokit = getClient();
  const res = await octokit.rest.repos.getRelease({
    owner: OWNER,
    repo: REPO,
    release_id: releaseId,
  });

  return res.data;
}

async function getIssuePullRequest(issueNumber) {
  const octokit = getClient();
  const res = await octokit.pulls.list({
    owner: OWNER,
    repo: REPO,
    state: 'all', // 'all' to include open, closed, and merged pull requests
    per_page: 50 // Adjust as needed for the number of PRs
  });

  const pullRequests = res.data.filter(x => x.body.includes(`#${issueNumber}`));
  if (pullRequests.size === 0) {
    throw new Error(`Cannot find linked Pull Request for issue #${issueNumber}`);
  }

  return pullRequests[0]
}

async function readAndUpdateVersionCode(name) {
  const octokit = getClient();
  const res = await octokit.rest.actions.getRepoVariable({
    owner: OWNER,
    repo: REPO,
    name: name,
    headers: {
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });

  if (res.status !== 200) {
    throw new Error(`Couldn\'t read variable ${name} value.`);
  }

  const newValue = parseInt(res.data.value) + 1;
  const updateRes = await octokit.rest.actions.updateRepoVariable({
    owner: OWNER,
    repo: REPO,
    name,
    value: `${newValue}`
  });

  if (updateRes.status !== 204) {
    throw new Error(`Couldn\'t update variable ${name} value.`);
  }

  return newValue;
}

function readManifestInfo(manifestPath) {
  const versionCodeRegexPattern = /versionCode\s*=\s*"(\d+(?:\.\d)*)"/mg;
  const versionNameRegexPattern = /versionName\s*=\s*"(\d+(?:\.\d+)*)"/mg;

  console.log(`Reading Manifest file from path: ${manifestPath}`);

  let fileContents = fs.readFileSync(manifestPath).toString();
  //console.log('fileContents', fileContents)

  const [, versionName] = versionNameRegexPattern.exec(fileContents);
  const [, versionCode] = versionCodeRegexPattern.exec(fileContents);

  if (!versionName) {
    throw new Error(`Version Code has no value: ${versionCode}`);

  }
  if (!versionCode) {
    throw new Error(`Cannot read versionCode value.`);
  }

  console.log('versionName: ' + versionName)
  console.log('versionCode: ' + versionCode)

  return {
    versionName,
    versionCode
  }
}

function updateManifest(manifestPath, versionName, versionCode) {
  let filecontent = fs.readFileSync(manifestPath).toString();
  fs.chmodSync(manifestPath, "600");

  filecontent = filecontent.replace(/versionName\s*=\s*"(\d+(?:\.\d+)*)"/mg, `versionName=\"${versionName}\"`);
  filecontent = filecontent.replace(/versionCode\s*=\s*"(\d+(?:\.\d)*)"/mg, `versionCode=\"${versionCode}\"`);

  fs.writeFileSync(manifestPath, filecontent);
}

function commitAndPushManifest(manifestPath, versionName, versionCode) {
  const buildVersion = `${versionName}-${versionCode}`
  const result = execSync(`git ci ${manifestPath} -m "Update build version to ${buildVersion}"`, { encoding: 'utf8' });
  console.log(result)

  const __filename = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(__filename)

  fs.chmodSync(`${currentDir}/scripts/gpush.sh`, "700");
  const result2 = execSync(`bash ${currentDir}/scripts/gpush.sh`, { encoding: 'utf8' });
  console.log(result2)
}

function buildBinaries(callback) {
  let cmd = `./gradlew clean generateGitProperties assembleRelease`;

  console.log(`Execute: ${cmd}`)
  console.log(`Building binaries...`)

  const buildProc = spawn('./gradlew', ['clean', 'generateGitProperties', 'assembleRelease']);
  buildProc.stdout.on('data', (data) => {
    console.log(`stdout: ${data}`);
  });

  buildProc.stderr.on('data', (data) => {
    console.error(`stderr: ${data}`);
  });

  buildProc.on('close', (code) => {
    console.log(`Build process exited with code ${code}`);

    callback()
      .then(x => console.log('Finished!'))
  });
}

async function addReleaseComment(issueNumber, releaseTag) {
  const url = `https://github.com/towbook/towbook-android/releases/tag/${releaseTag}`;
  const octokit = getClient();
  const res = await octokit.rest.issues.createComment({
    owner: OWNER,
    repo: REPO,
    issue_number: issueNumber,
    body: `Available to test in Build [${releaseTag}](${url})`,
  });

  return res.data;
}

export async function run(issueNumber, repoPath) {
  const manifestPath = `${repoPath}/app/src/main/AndroidManifest.xml`
  const versionCode = await readAndUpdateVersionCode("VERSION_CODE");
  const manifestInfo = readManifestInfo(manifestPath)

  // update Manifest
  updateManifest(manifestPath, manifestInfo.versionName, versionCode)

  // commit & push Manifest changes
  commitAndPushManifest(manifestPath, manifestInfo.versionName, versionCode)

  // generate apk file
  buildBinaries(async () => {
    const pullRequest = await getIssuePullRequest(issueNumber);
    const pullNumber = pullRequest.number;

    const res = await createRelease(manifestInfo.versionName, versionCode, true, issueNumber, pullNumber);
    const release = await getRelease(res.id);

    console.log(`* Target Issue: #${issueNumber}`);
    console.log(`* Target PR : #${pullNumber}`);
    console.log("* Release " + release.tag_name + " created!");
    console.log("* Url: " + release.html_url);

    const releaseTag = `${manifestInfo.versionName}-${versionCode}`;
    const fileName = `towbook-${releaseTag}.apk`;
    const filePath = `${repoPath}/app/build/outputs/apk/release/${fileName}`;

    console.log(`Uploading asset ${fileName} to release ${release.tag_name}...`);
    const asset = await uploadReleaseAsset(release.id, filePath, fileName);

    console.log(`* Upload state: ${asset.state}`)
    if (asset.state === 'uploaded') {
      console.log(`* Asset url: ${asset.browser_download_url}`)
    }

    //add issue comment with release link
    addReleaseComment(issueNumber, releaseTag);
    console.log(`Comment added into issue #${issueNumber} linking the current release ${release.tag_name} build.`)

    console.lod('Build finished!')
  })
}