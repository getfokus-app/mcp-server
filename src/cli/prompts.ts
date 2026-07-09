import readline from 'node:readline';

export function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

const CTRL_C = '\u0003';
const CTRL_D = '\u0004';
const BACKSPACE = '\u007f';

/** Prompt without echoing the typed characters (for passwords). */
export function askHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return ask(question);

  return new Promise((resolve) => {
    process.stdout.write(question);
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    let value = '';

    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      process.stdout.write('\n');
      resolve(value);
    };

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\n' || char === '\r' || char === CTRL_D) {
          finish();
          return;
        }
        if (char === CTRL_C) {
          process.stdout.write('\n');
          process.exit(130);
        }
        if (char === BACKSPACE || char === '\b') {
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      }
    };

    stdin.on('data', onData);
  });
}
