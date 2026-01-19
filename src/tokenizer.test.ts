import { describe, expect, it } from 'bun:test';
import { tokenizeLine, type Token } from './tokenizer';

describe('tokenizeLine', () => {
  it('tokenizes normal spacing', () => {
    const line = 'mov x0, #0 ';
    const token1: Token = {
      startCol: 0,
      endCol: 3,
      kind: 'ident',
      text: 'mov',
    };

    const token2: Token = {
      startCol: 4,
      endCol: 6,
      kind: 'ident',
      text: 'x0',
    };
    const token3: Token = {
      startCol: 6,
      endCol: 7,
      kind: 'comma',
      text: ',',
    };

    const token4: Token = {
      kind: 'ident',
      text: '#0',
      startCol: 8,
      endCol: 10,
    };

    expect(tokenizeLine(line)).toEqual([token1, token2, token3, token4]);
  });

  it('handles tabs and extra whitespace', () => {
    const line = '\tadd\t  x1, x2, #10 ';
    const tokens: Token[] = [
      { kind: 'ident', text: 'add', startCol: 1, endCol: 4 },
      { kind: 'ident', text: 'x1', startCol: 7, endCol: 9 },
      { kind: 'comma', text: ',', startCol: 9, endCol: 10 },
      { kind: 'ident', text: 'x2', startCol: 11, endCol: 13 },
      { kind: 'comma', text: ',', startCol: 13, endCol: 14 },
      { kind: 'ident', text: '#10', startCol: 15, endCol: 18 },
    ];

    expect(tokenizeLine(line)).toEqual(tokens);
  });

  it('parses string literals as string tokens', () => {
    const line = '.ascii "hello world" ';
    const tokens: Token[] = [
      { kind: 'ident', text: '.ascii', startCol: 0, endCol: 6 },
      { kind: 'string', text: '"hello world"', startCol: 7, endCol: 20 },
    ];

    expect(tokenizeLine(line)).toEqual(tokens);
  });
});
