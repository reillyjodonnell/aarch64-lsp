// takes

import type { Token } from './tokenizer';

const trackedRegisters = {
  x0: true,
  x1: true,
  x2: true,
  x3: true,
  x4: true,
  x5: true,
  x8: true,
} as const;

type Registers = keyof typeof trackedRegisters;

type RegisterInfo = Record<
  Registers,
  {
    kind: 'imm';
    value: string;
    setLine: number;
    startCol: number;
    endCol: number;
  } | null
>;

function isTrackedReg(s: string): s is Registers {
  return s in trackedRegisters;
}

export const getHintsFromTokens = (data: Record<number, Array<Token>>) => {
  const registerInfo: RegisterInfo = {
    x0: null,
    x1: null,
    x2: null,
    x3: null,
    x4: null,
    x5: null,

    x8: null,
  };

  type Hint = {
    inline: string;
    hover: string;
  };

  const hintsPerLine: Record<number, Array<Hint>> = {};

  for (const [key, value] of Object.entries(data)) {
    const lineNumber = Number(key);

    if (value[0]?.text === 'svc') {
      if (value[1]?.text === '#0') {
        // we want to update the lines containing the x0->x5., x8, and svc
        const existing = hintsPerLine[lineNumber] ?? [];
        const x8Entry = registerInfo['x8'];

        if (x8Entry) {
          const number = getNumberFromImmediate(x8Entry.value);
          const syscallEntry = syscalls[number];
          if (!syscallEntry) continue;
          const match = typeof number === 'number' && syscallEntry.name;

          // write tip for x8
          const existingTipForX8 = hintsPerLine[x8Entry.setLine] ?? [];
          existingTipForX8.push({
            inline: `syscall: ${syscallEntry.name} (${number})`,
            hover: '',
          });
          hintsPerLine[x8Entry.setLine] = existingTipForX8;

          for (const k of Object.keys(syscallEntry.args)) {
            if (!isTrackedReg(k)) continue;
            const entry = registerInfo[k];
            if (!entry) continue;
            const existingHintForRegisters = hintsPerLine[entry.setLine] ?? [];
            const value =
              syscallEntry.args[k]?.name === 'fd' &&
              fdLookup[getNumberFromImmediate(entry.value)]
                ? fdLookup[getNumberFromImmediate(entry.value)]
                : entry.value;
            existingHintForRegisters.push({
              hover: '',
              inline: `${syscallEntry.args[k]?.name}: ${value}`,
            });
            hintsPerLine[entry.setLine] = existingHintForRegisters;
          }

          existing.push({
            hover: '',
            //read(fd=0, buf=&buffer, count=20) → x0=bytes_read | -errno
            inline: match
              ? `${syscallEntry.name}(args) → ${syscallEntry.returns?.x0}`
              : '',
          });
        }

        hintsPerLine[lineNumber] = existing;
      } else {
        // we want to update the lines containing the x0->x5., x8, and svc
        const existing = hintsPerLine[lineNumber] ?? [];

        if (registerInfo['x8']) {
          existing.push({
            hover: '',
            inline: `expects #0`,
          });
        }

        hintsPerLine[lineNumber] = existing;
      }
    }

    if (value[0]?.text === 'mov') {
      // token is svc or mov so let's get register
      if (isTrackedReg(value[1]?.text ?? '')) {
        // put value (2nd position is comma)
        const nextToken = value[3];
        if (!nextToken) throw new Error('Missing token');
        const { endCol, kind, startCol, text } = nextToken;

        const entry: RegisterInfo['x0'] = {
          kind: 'imm',
          value: text,
          setLine: lineNumber,
          startCol,
          endCol,
        };
        if (value[1]?.text) {
          registerInfo[value[1].text] = entry;
        }
      }
    }
    continue;
  }
  return hintsPerLine;
};

const getNumberFromImmediate = (str: string): number => {
  const number = str.split('#')[1];
  return Number(number);
};

type SyscallEntry = {
  name: string;
  args: Record<string, { name: string; notes?: string }>;
  returns?: unknown;
};

const syscalls: Record<number, SyscallEntry> = {
  56: {
    name: 'openat',
    args: {
      x0: { name: 'dirfd', notes: 'often AT_FDCWD = -100' },
      x1: { name: 'pathname' },
      x2: { name: 'flags' },
      x3: { name: 'mode' },
    },
    returns: { x0: 'fd (>=0) or -errno' },
  },
  63: {
    name: 'read',
    args: {
      x0: { name: 'fd', notes: '0=stdin, 1=stdout, 2=stderr (conventional)' },
      x1: { name: 'buf' },
      x2: { name: 'count' },
    },
    returns: { x0: 'bytes_read (>=0) or -errno' },
  },
  64: {
    name: 'write',
    args: {
      x0: { name: 'fd', notes: '0=stdin, 1=stdout, 2=stderr (conventional)' },
      x1: { name: 'buf' },
      x2: { name: 'count' },
    },
    returns: { x0: 'bytes_written (>=0) or -errno' },
  },
  93: {
    name: 'exit',
    args: {
      x0: { name: 'status' },
    },
    returns: { x0: '(does not return)' },
  },
} as const;

const fdLookup = {
  0: 'stdin',
  1: 'stdout',
  2: 'stderr',
};
