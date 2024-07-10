import path from 'path'
import { buildRelease } from './command.js';

if (process.argv.length < 3) {
  console.error("Param [issue number] is missing.")
  process.exit(1)
}

const version = process.argv[2];

(async () => {
  const repoDir = path.resolve()
  console.log('Repo Directory : ', repoDir)
  console.log('Release version: ', version);

  await buildRelease(version, repoDir);
})();
