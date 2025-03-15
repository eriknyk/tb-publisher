import path from 'path'
import { runUpdateAppVersion } from './command.js';

if (process.argv.length < 3) {
  console.error("Param [issue number] is missing.")
  process.exit(1)
}

const issueNumber = process.argv[2];

(async () => {
  const repoDir = path.resolve()
  await runUpdateAppVersion(repoDir, issueNumber);
})();
