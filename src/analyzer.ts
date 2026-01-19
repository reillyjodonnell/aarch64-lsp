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
};

type Registers = 'x0' | 'x1' | 'x2' | 'x3' | 'x4' | 'x5' | 'x8';

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

function isTrackedReg(s: string) {
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

        if (registerInfo['x8']) {
          const number =
            registerInfo['x8']?.value &&
            getNumberFromImmediate(registerInfo['x8']?.value);
          const match = typeof number === 'number' && syscalls[number]?.name;

          existing.push({
            hover: '',
            inline: match && `sys call: ${match}`,
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

const getNumberFromImmediate = (str: string) => {
  const number = str.split('#')[1];
  return Number(number);
};

const syscalls = {
  93: { name: 'exit', args: ['status (x0)'] },
  63: { name: 'read', args: ['fd (x0)', 'buf (x1)', 'count (x2)'] },
  64: { name: 'write', args: ['fd (x0)', 'buf (x1)', 'count (x2)'] },
  // ... etc
};
