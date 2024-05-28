import { fileURLToPath } from 'url';
import path from 'path'
import { run } from './command.js';

(async () => {
  // const __filename = fileURLToPath(import.meta.url);
  // const currentDir = path.dirname(__filename)
  // console.log('currentDir = ', currentDir)
  const repoPath = "/Users/erik/Github/towbook-android-release";
  await run(1123, repoPath);
})();