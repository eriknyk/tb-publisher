import path from 'path'
import { run } from './command.js';

if (process.argv.length < 3) {
  console.error("Param [issue number] is missing.")
  process.exit(1)
}

const issueNumber = process.argv[2];

(async () => {
  const repoDir = path.resolve()
  console.log('Repo Directory : ', repoDir)
  console.log('Issue Number   : ', issueNumber);

  await run(issueNumber, repoDir);
})();
