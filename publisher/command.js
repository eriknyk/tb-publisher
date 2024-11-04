import fs from 'fs';
import path from 'path';
import { spawn } from 'node:child_process';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

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

async function createGithubPreRelease(versionName, buildNumber, prerelease, issueNumber, pullNumber) {
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

async function createGithubRelease(versionName, buildNumber, pullRequest) {
  const octokit = getClient();

  const tag = `${versionName}-${buildNumber}`;
  const body = pullRequest.body;
  const releaseName = `Release ${tag}`

  const res = await octokit.rest.repos.createRelease({
    owner: OWNER,
    repo: REPO,
    tag_name: tag,
    target_commitish: 'release',
    name: releaseName,
    body: body,
    draft: false,
    prerelease: false,
    generate_release_notes: false
  })

  return res.data;
}

async function uploadReleaseAsset(releaseId, filePath, fileName) {
  //const octokit = getClient();
  //const fileContent = fs.readFileSync(filePath);
  //const fileStats = fs.statSync(filePath);

  const response = await uploadReleaseAssetApi({
    owner: OWNER,
    repo: REPO,
    release_id: releaseId,
    file_path: filePath,
    asset_name: fileName,
    token: process.env.GH_TOKEN
  });

  return response.data;
};

async function uploadReleaseAssetApi({owner, repo, release_id, file_path, asset_name, token}) {
  const fileStat = fs.statSync(file_path);
  const fileSize = fileStat.size;
  const contentType = 'application/octet-stream';

  // GitHub API endpoint for uploading assets
  const uploadUrl = `https://uploads.github.com/repos/${owner}/${repo}/releases/${release_id}/assets?name=${asset_name}`;

  // Create a readable stream of the file
  const fileStream = fs.createReadStream(file_path);

  // Keep track of uploaded bytes
  let uploadedBytes = 0;

  // Listen to data events to calculate progress
  fileStream.on('data', (chunk) => {
    uploadedBytes += chunk.length;
    const progress = ((uploadedBytes / fileSize) * 100).toFixed(2);
    process.stdout.write(`Uploading ${asset_name}: ${progress}%\r`);
  });

  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `token ${token}`,
      'Content-Type': contentType,
      'Content-Length': fileSize,
    },
    body: fileStream,
    duplex: 'half', // required for streaming body in Node.js 18+
  });

  if (response.ok) {
    console.log(`\nAsset ${asset_name} uploaded successfully!`);
    const responseBody = await response.json();
    console.log(responseBody); // contains details of the uploaded asset

    return {
      data: responseBody
    }
  } else {
    console.error('\nFailed to upload asset:', response.status, response.statusText);
    const errorText = await response.text();
    console.error('Error details:', errorText);
  }
}

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
    state: 'open', // 'all' to include open, closed, and merged pull requests
    per_page: 50 // Adjust as needed for the number of PRs
  });
  const { data } = res
  const pullRequests = data.filter(x => x.body && x.body.includes(`#${issueNumber}`));

  if (pullRequests.size === 0) {
    throw new Error(`Cannot find linked Pull Request for issue #${issueNumber}`);
  }

  return pullRequests[0]
}

async function getReleasePullRequest(versionName) {
  const octokit = getClient();
  const res = await octokit.pulls.list({
    owner: OWNER,
    repo: REPO,
    state: 'open', // 'all' to include open, closed, and merged pull requests
    per_page: 50 // Adjust as needed for the number of PRs
  });
  const { data } = res
  const pullRequests = data.filter(x => x.body && x.body.startsWith(`Release ${versionName}`));

  if (pullRequests.size === 0) {
    throw new Error(`Cannot find linked Pull Request for release #${versionName}`);
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

function buildBinaries(type = undefined, callback) {
  let cmd = `./gradlew clean generateGitProperties assembleRelease`;

  if (type === 'release') {
    cmd += " bundleRelease";
  }

  console.log(`Execute: ${cmd}`)
  console.log(`Building binaries...`)

  const [gradleCmd, ...args] = cmd.split(' ');
  const buildProc = spawn(gradleCmd, args);
  
  buildProc.stdout.on('data', (data) => {
    console.log(`stdout: ${data}`);
  });

  buildProc.stderr.on('data', (data) => {
    console.error(`stderr: ${data}`);
  });

  buildProc.on('close', (code) => {
    console.log(`Build process exited with code ${code}`);

    if (parseInt(code) === 0) {
      callback().then(x => console.log('Finished!'))
    }
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

function increaseVersion(versionName, x, y, z) {
  if (!versionName) 
    return versionName;

  const parts = versionName.split('.');
  
  if (parts.length !== 3) 
    return versionName;

  const x1 = parseInt(parts[0]) + x;
  const y1 = parseInt(parts[1]) + y;
  const z1 = parseInt(parts[2]) + z;

  return `${x1}.${y1}.${z1}`;
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
  buildBinaries('prerelease', async () => {
    const pullRequest = await getIssuePullRequest(issueNumber);
    const pullNumber = pullRequest.number;

    const res = await createGithubPreRelease(manifestInfo.versionName, versionCode, true, issueNumber, pullNumber);
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
    const comment = await addReleaseComment(issueNumber, releaseTag);
    console.log(`Comment added into issue #${issueNumber} linking the current release ${release.tag_name} build.`)
    console.log(`Comment link: ${comment.html_url}`)

    console.log('Build finished!')
  })
}

export async function buildRelease(versionName, repoPath) {
  const manifestPath = `${repoPath}/app/src/main/AndroidManifest.xml`
  const versionCode = await readAndUpdateVersionCode("VERSION_CODE");

  // update Manifest
  updateManifest(manifestPath, versionName, versionCode)

  // commit & push Manifest changes
  commitAndPushManifest(manifestPath, versionName, versionCode)

  buildBinaries('release', async () => {
    const pullRequest = await getReleasePullRequest(versionName);
    
    const res = await createGithubRelease(versionName, versionCode, pullRequest);
    console.log(`* Created github release: ${res.id} / ${res.tag_name}`)
    
    const release = await getRelease(res.id);

    const releaseTag = `${versionName}-${versionCode}`;

    // upload 1
    const fileName = `towbook-${releaseTag}.apk`;
    const filePath = `${repoPath}/app/build/outputs/apk/release/${fileName}`;

    console.log(`Uploading asset ${fileName} to release ${release.tag_name}...`);
    const asset = await uploadReleaseAsset(release.id, filePath, fileName);

    console.log(`* Upload state: ${asset.state}`)
    if (asset.state === 'uploaded') {
      console.log(`* Asset url: ${asset.browser_download_url}`)
    }

    // upload 2
    const fileName2 = `towbook-${releaseTag}.aab`;
    const filePath2 = `${repoPath}/app/build/outputs/bundle/release/app-release.aab`;

    console.log(`Uploading asset ${fileName2} to release ${release.tag_name}...`);
    const asset2 = await uploadReleaseAsset(release.id, filePath2, fileName2);

    console.log(`* Upload state: ${asset2.state}`)
    if (asset2.state === 'uploaded') {
      console.log(`* Asset url: ${asset2.browser_download_url}`)
    }

    console.log('Build finished!')
  })
}