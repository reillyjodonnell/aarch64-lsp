import {
  createConnection,
  ProposedFeatures,
  CompletionItemKind,
  type InitializeResult,
  InlayHint,
  InlayHintKind,
} from 'vscode-languageserver/node';

import { TextDocuments } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { tokenizeLine, type Token } from './tokenizer';

let allTokens: Record<number, Array<Token>> = {};

const documents = new TextDocuments(TextDocument);

const syscalls = {
  93: { name: 'exit', args: ['status (x0)'] },
  63: { name: 'read', args: ['fd (x0)', 'buf (x1)', 'count (x2)'] },
  64: { name: 'write', args: ['fd (x0)', 'buf (x1)', 'count (x2)'] },
  // ... etc
};

const instructionDocs: Record<string, { title: string; lines: string[] }> = {
  mov: {
    title: '**mov dst, src** — copy value',
    lines: [
      'Moves a register or immediate into `dst`. Alias for `orr`/`add` under the hood.',
      'Common forms: `mov x0, x1`, `mov x0, #1`, `mov w0, wzr` (zero).',
    ],
  },
  ldr: {
    title: '**ldr dst, [base, #off]** — load from memory',
    lines: [
      'Reads from memory into a register. Size is based on register width (`w` = 32-bit, `x` = 64-bit).',
      'Examples: `ldr x0, [sp, #16]`, `ldr w1, [x2]`, `ldr x3, =label` (pseudo).',
    ],
  },
  str: {
    title: '**str src, [base, #off]** — store to memory',
    lines: [
      'Writes a register to memory. Uses register width for store size.',
      'Examples: `str x0, [sp, #16]`, `str w1, [x2]`.',
    ],
  },
  strb: {
    title: '**strb wt, [base, #off]** — store byte',
    lines: [
      'Stores the low 8 bits of `wt` to memory. Size is fixed to 1 byte.',
      'Uses the `w` form because byte/halfword ops only read the low bits; the `x` alias is not valid.',
    ],
  },
  add: {
    title: '**add dst, src, imm/reg** — add',
    lines: [
      'Adds register or immediate to `src` and writes to `dst`.',
      'Examples: `add x0, x1, x2`, `add x0, x0, #16`, `add sp, sp, #-16` (stack adjust).',
    ],
  },
  sub: {
    title: '**sub dst, src, imm/reg** — subtract',
    lines: [
      'Subtracts immediate or register from `src` into `dst`. Often used for stack setup/teardown.',
      'Examples: `sub sp, sp, #16`, `sub x0, x0, x1`.',
    ],
  },
  adr: {
    title: '**adr dst, label** — PC-relative address',
    lines: [
      'Computes a nearby address relative to the current PC and writes it to `dst`.',
      'Range is roughly +/-1 MB. For farther addresses use `adrp` + `add`.',
    ],
  },
  adrp: {
    title: '**adrp dst, label** — page-relative address',
    lines: [
      'Loads the 4 KB page of a symbol into `dst` (low 12 bits zeroed).',
      'Typically paired with `add dst, dst, :lo12:symbol` to get the full address.',
    ],
  },
  bl: {
    title: '**bl label** — branch with link (call)',
    lines: [
      'Calls a function by branching and saving return address to `x30` (link register).',
      'Return with `ret` (uses `x30` by default).',
    ],
  },
  ret: {
    title: '**ret [reg]** — return',
    lines: [
      'Returns to the address in `reg` (`x30` if omitted).',
      'Example: `ret`, or `ret x19` for tail-calls through a callee-saved register.',
    ],
  },
  cmp: {
    title: '**cmp a, b** — compare',
    lines: [
      'Subtracts `b` from `a` and sets flags; no writeback.',
      'Use with conditional branches like `b.eq`, `b.ne`, `b.lt`, `b.ge`.',
    ],
  },
  b: {
    title: '**b label / b.<cond> label** — branch',
    lines: [
      'Unconditional or conditional branch. `b label` always jumps.',
      'Conditional forms read NZCV flags set by `cmp`, `adds`, etc. Example: `b.eq loop`.',
    ],
  },
  cbz: {
    title: '**cbz reg, label** — branch if zero',
    lines: [
      'Tests register and branches when it is zero. Uses a small immediate offset.',
      'Pair with `cbnz` for the non-zero case.',
    ],
  },
  cbnz: {
    title: '**cbnz reg, label** — branch if non-zero',
    lines: [
      'Opposite of `cbz`: branches when register is non-zero.',
      'Good for short loops or guards without using flags.',
    ],
  },
};

const registerCompletions = buildRegisterCompletions();
const syscallCompletions = buildSyscallCompletions();

const connection = createConnection(ProposedFeatures.all);

connection.onInitialize(() => {
  const result: InitializeResult = {
    capabilities: {
      hoverProvider: true,
      completionProvider: {
        triggerCharacters: ['.', ' '],
      },
      textDocumentSync: 1, // 1 = send full document on change
      inlayHintProvider: true,
    },
  };
  console.error('Client connected!');
  return result;
});

function codeEndColumn(line: string): number {
  let cut = line.length;

  const slash = line.indexOf('//');
  if (slash !== -1) cut = Math.min(cut, slash);

  const at = line.indexOf('@');
  if (at !== -1) cut = Math.min(cut, at);

  return cut;
}

connection.languages.inlayHint.on((params): InlayHint[] => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];

  const text = doc.getText();
  const lines = text.split(/\r?\n/);

  const hints: InlayHint[] = [];

  for (let line = 0; line < lines.length; line++) {
    const lineText = lines[line];
    if (lineText?.trim().length === 0) continue;

    const end = codeEndColumn(lineText);
    const code = lineText?.slice(0, end);

    const trimmed = code?.trimStart();
    if (trimmed?.startsWith('.') || trimmed?.endsWith(':')) continue; // directives + labels

    if (code?.trim().length === 0) continue; // comment-only line → skip

    if (code?.length) {
      const result = tokenizeLine(code);
      console.log('result: ', result);
      allTokens[line] = result;
    }

    if (
      allTokens[line]?.find(
        (token) => token.kind === 'ident' && token.text === 'x0',
      )
    ) {
      hints.push({
        position: { line, character: end },
        label: ' ⟵ file descriptor (0: stdin)',
        paddingLeft: true,
        kind: InlayHintKind.Parameter, // doesn't really matter for v1
        paddingRight: false,
      });
    }

    if (
      allTokens[line]?.find(
        (token) => token.kind === 'ident' && token.text === '=buffer',
      )
    ) {
      hints.push({
        position: { line, character: end },
        label: ' ⟵ buf: addr(buffer)',
        paddingLeft: true,
        kind: InlayHintKind.Parameter, // doesn't really matter for v1
        paddingRight: false,
      });
    }

    if (
      allTokens[line]?.find(
        (token) => token.kind === 'ident' && token.text === 'x2',
      )
    ) {
      hints.push({
        position: { line, character: end },
        label: ' ⟵ 20 bytes',
        paddingLeft: true,
        kind: InlayHintKind.Parameter, // doesn't really matter for v1
        paddingRight: false,
      });
    }

    if (
      allTokens[line]?.find(
        (token) => token.kind === 'ident' && token.text === 'x8',
      )
    ) {
      hints.push({
        position: { line, character: end },
        label: ' ⟵ syscall: read',
        paddingLeft: true,
        kind: InlayHintKind.Parameter, // doesn't really matter for v1
        paddingRight: false,
      });
    }

    if (
      allTokens[line]?.find(
        (token) => token.kind === 'ident' && token.text === 'svc',
      )
    ) {
      hints.push({
        position: { line, character: end },
        label:
          ' ⟵ (fd=stdin(0), buf=addr(buffer), count=20) -> x0=bytes_read | -errno',
        paddingLeft: true,
        kind: InlayHintKind.Parameter, // doesn't really matter for v1
        paddingRight: false,
      });
    }

    // hints.push({
    //   position: { line, character: end },
    //   label: ' ⟵ fd: stdin',
    //   paddingLeft: true,
    //   kind: InlayHintKind.Parameter, // doesn't really matter for v1
    //   paddingRight: false,
    // });
  }

  return hints;
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
  const lower = tok?.text.toLowerCase();

  if (!lower) return null;

  const regHover = getRegisterHover(lower);
  if (regHover) return regHover;

  const instrDoc = instructionDocs[lower];
  if (instrDoc) {
    return {
      contents: { kind: 'markdown', value: formatDoc(instrDoc) },
    };
  }

  switch (lower) {
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

connection.onCompletion((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const lineText = doc.getText({
    start: { line: params.position.line, character: 0 },
    end: { line: params.position.line, character: 10_000 },
  });

  const current = getTokenAt(lineText, params.position.character)?.text ?? '';
  const tokens = lineText
    .slice(0, params.position.character)
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());

  const instr = tokens[0];
  if (instr === 'mov') {
    // If moving into x8, suggest syscall numbers; otherwise suggest registers
    const dst = tokens[1];
    if (dst === 'x8' || dst === 'w8' || current.toLowerCase() === 'x8') {
      return syscallCompletions;
    }
    return registerCompletions;
  }

  // Fallback: no completions
  return null;
});

connection.onRequest((method, params) => {
  console.error('[REQ]', method, JSON.stringify(params, null, 2));
  // return undefined to let it fall through to specific handlers
});

connection.onNotification((method, params) => {
  console.error('[NOTIF]', method, JSON.stringify(params, null, 2));
});

function getRegisterHover(name: string) {
  // Let the syscall table handle x8 specially
  if (name === 'x8' || name === 'w8') return null;

  const xMatch = name.match(/^x([0-9]|1[0-9]|2[0-9]|3[01])$/);
  const wMatch = name.match(/^w([0-9]|1[0-9]|2[0-9]|3[01])$/);

  if (xMatch || wMatch) {
    const num = Number(xMatch?.[1] ?? wMatch?.[1]);
    const width = xMatch ? '64-bit' : '32-bit (low half of x register)';

    if (num === 0) {
      return {
        contents: {
          kind: 'markdown',
          value: formatDoc({
            title: `**${name}** — arg0 / return value`,
            lines: [
              `${width}. Function return register and first argument.`,
              'Caller-saved; clobbered by calls.',
            ],
          }),
        },
      };
    }

    if (num >= 1 && num <= 7) {
      return {
        contents: {
          kind: 'markdown',
          value: formatDoc({
            title: `**${name}** — arg${num}`,
            lines: [
              `${width}. Function argument ${num}.`,
              'Caller-saved; clobbered by calls.',
            ],
          }),
        },
      };
    }

    if (num === 16 || num === 17) {
      return {
        contents: {
          kind: 'markdown',
          value: formatDoc({
            title: `**${name}** — call-scratch`,
            lines: [
              `${width}. Scratch for veneer / plt stubs (AAPCS64 call clobber).`,
              'Caller-saved; do not rely on value across calls.',
            ],
          }),
        },
      };
    }

    if (num === 18) {
      return {
        contents: {
          kind: 'markdown',
          value: formatDoc({
            title: `**${name}** — platform reserved (Linux)`,
            lines: [
              `${width}. Reserved platform register on Linux AArch64 (x18).`,
              'Do not use or clobber; toolchain/runtime may own it (e.g. TLS).',
            ],
          }),
        },
      };
    }

    if (num >= 9 && num <= 15) {
      return {
        contents: {
          kind: 'markdown',
          value: formatDoc({
            title: `**${name}** — caller-saved temp`,
            lines: [
              `${width}. Temporary register; free to use inside a function.`,
              'Caller must save if needed across calls.',
            ],
          }),
        },
      };
    }

    if (num >= 19 && num <= 28) {
      return {
        contents: {
          kind: 'markdown',
          value: formatDoc({
            title: `**${name}** — callee-saved`,
            lines: [
              `${width}. Preserve across calls (save/restore if you change it).`,
              'Good for long-lived locals or pointers.',
            ],
          }),
        },
      };
    }

    if (num === 29) {
      return {
        contents: {
          kind: 'markdown',
          value: formatDoc({
            title: `**${name} / fp** — frame pointer`,
            lines: [
              `${width}. Callee-saved. Points to the current stack frame when used.`,
              'Optional but common in debuggable builds.',
            ],
          }),
        },
      };
    }

    if (num === 30) {
      return {
        contents: {
          kind: 'markdown',
          value: formatDoc({
            title: `**${name} / lr** — link register`,
            lines: [
              `${width}. Holds return address after ` + '`bl`' + ' or `blr`.',
              'Caller-saved; spilled to the stack in most prologues.',
            ],
          }),
        },
      };
    }
  }

  if (name === 'sp' || name === 'wsp') {
    return {
      contents: {
        kind: 'markdown',
        value: formatDoc({
          title: `**${name}** — stack pointer`,
          lines: [
            'Always 16-byte aligned. Do not use for arithmetic besides stack movement.',
            'Use `sub sp, sp, #N` / `add sp, sp, #N` to open/close stack space.',
          ],
        }),
      },
    };
  }

  if (name === 'fp') {
    return {
      contents: {
        kind: 'markdown',
        value: formatDoc({
          title: '**fp (x29)** — frame pointer',
          lines: [
            'Alias of x29. Callee-saved. Points to current frame when enabled.',
          ],
        }),
      },
    };
  }

  if (name === 'lr') {
    return {
      contents: {
        kind: 'markdown',
        value: formatDoc({
          title: '**lr (x30)** — link register',
          lines: [
            'Alias of x30. Holds return address. Spill if you need it after a call.',
          ],
        }),
      },
    };
  }

  return null;
}

function formatDoc(doc: { title: string; lines: string[] }) {
  return [doc.title, '', ...doc.lines].join('\n');
}

function buildRegisterCompletions() {
  const regs: { label: string; detail: string }[] = [];
  const push = (label: string, detail: string) => regs.push({ label, detail });

  for (let i = 0; i <= 30; i++) {
    push(`x${i}`, '64-bit general-purpose');
    push(`w${i}`, '32-bit low half');
  }

  push('sp', 'stack pointer');
  push('wsp', 'stack pointer (32-bit view)');
  push('fp', 'frame pointer (x29)');
  push('lr', 'link register (x30)');
  push('xzr', 'zero register (64-bit)');
  push('wzr', 'zero register (32-bit)');

  return regs.map((r) => ({
    label: r.label,
    kind: CompletionItemKind.Variable,
    detail: r.detail,
  }));
}

function buildSyscallCompletions() {
  return Object.entries(syscalls)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([num, info]) => ({
      label: num,
      kind: CompletionItemKind.Constant,
      detail: info.name,
      documentation: info.args?.length ? info.args.join(', ') : undefined,
    }));
}

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
