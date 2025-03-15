import { execSync } from 'child_process';
import c from 'chalk';

export function execCommand(cmd, displayOutput = false) {
  const output = execSync(cmd, { encoding: 'utf8' })
  if (displayOutput) {
    console.log(output)
  } else {
    return output
  }
}

export function logKeyValue(key, value) {
  const length = 20
  console.log(c.green(key.padStart(length, ' ') + ":") + " " + c.dim(value));
}