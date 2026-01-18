import {
  createConnection,
  ProposedFeatures,
  type InitializeResult,
} from 'vscode-languageserver/node';

import { TextDocuments } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

const documents = new TextDocuments(TextDocument);

const syscalls = {
  93: { name: 'exit', args: ['status (x0)'] },
  63: { name: 'read', args: ['fd (x0)', 'buf (x1)', 'count (x2)'] },
  64: { name: 'write', args: ['fd (x0)', 'buf (x1)', 'count (x2)'] },
  // ... etc
};

const connection = createConnection(ProposedFeatures.all);

connection.onInitialize(() => {
  const result: InitializeResult = {
    capabilities: {
      hoverProvider: true,
      completionProvider: {
        triggerCharacters: ['.', ' '],
      },
      textDocumentSync: 1, // 1 = send full document on change
    },
  };
  console.error('Client connected!');
  return result;
});

documents.listen(connection);
connection.listen();

connection.onHover((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const lineText = doc.getText({
    start: { line: params.position.line, character: 0 },
    end: { line: params.position.line, character: 10_000 },
  });

  const ch = params.position.character;

  const tok = getTokenAt(lineText, params.position.character);

  switch (tok?.text.toLowerCase()) {
    case 'svc': {
      return {
        contents: {
          kind: 'markdown',
          value: [
            '**svc #0** — enter the kernel to make a system call (AArch64 Linux)',
            '',
            '`svc #0` triggers a *trap* into the Linux kernel. The kernel looks at `x8` to decide',
            'which syscall to run, uses `x0`–`x5` as arguments, then returns a result in `x0`.',
            '',
            '**Calling convention (Linux AArch64)**',
            '- `x8` = syscall number (e.g. `64` = `write`)',
            '- `x0`–`x5` = arguments',
            '- `x0` = return value (negative = error)',
          ].join('\n'),
        },
      };
    }
    case 'x8': {
      // Build markdown table of syscalls
      const rows = Object.entries(syscalls)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([num, info]) => {
          const args = info.args?.length ? info.args.join(', ') : '—';
          // escape pipes so markdown table doesn't break
          const safeArgs = args.replace(/\|/g, '\\|');
          return `| \`${num}\` | \`${info.name}\` | ${safeArgs} |`;
        })
        .join('\n');

      const md = [
        `**AArch64 Linux syscalls**`,
        ``,
        `Syscall number goes in \`x8\`. Args go in \`x0\`–\`x5\`. Return value in \`x0\`.`,
        ``,
        `| # | name | args |`,
        `|---:|---|---|`,
        rows || `| — | — | — |`,
        ``,
        `_Tip: after setting \`x8\`, execute \`svc #0\`._`,
      ].join('\n');

      return {
        contents: { kind: 'markdown', value: md },
      };
    }
  }

  return null;
});

connection.onRequest((method, params) => {
  console.error('[REQ]', method, JSON.stringify(params, null, 2));
  // return undefined to let it fall through to specific handlers
});

connection.onNotification((method, params) => {
  console.error('[NOTIF]', method, JSON.stringify(params, null, 2));
});

function isAsciiAlphaNumUnderscore(code: number) {
  // A-Z
  if (code >= 65 && code <= 90) return true;
  // a-z
  if (code >= 97 && code <= 122) return true;
  // 0-9
  if (code >= 48 && code <= 57) return true;
  // _
  if (code === 95) return true;
  return false;
}

function getTokenAt(line: string, pos: number) {
  if (line.length === 0) return null;

  const inBounds = (i: number) => i >= 0 && i < line.length;
  const isWordCharAt = (i: number) =>
    inBounds(i) && isAsciiAlphaNumUnderscore(line.charCodeAt(i));

  // If hovering *between* chars or on punctuation/space, it’s common to snap left
  let i = pos;
  if (!isWordCharAt(i) && isWordCharAt(i - 1)) i = i - 1;

  if (!isWordCharAt(i)) return null;

  let start = i;
  let end = i + 1;

  while (isWordCharAt(start - 1)) start--;
  while (isWordCharAt(end)) end++;

  return { text: line.slice(start, end), start, end };
}
