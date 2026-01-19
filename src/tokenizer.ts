export type TokenKind = 'ident' | 'comma' | 'comment' | 'string';

export type Token = {
  kind: TokenKind;
  text: string;
  startCol: number;
  endCol: number;
};

export const tokenizeDocument = (text: string) => {
  const data: Record<number, Array<Token>> = {};

  const lines = text.split(/\r?\n/);

  for (let line = 0; line < lines.length; line++) {
    const lineText = lines[line];
    if (lineText && lineText?.trim().length === 0) continue;

    if (lineText) {
      data[line] = tokenizeLine(lineText);
    }
  }
  return data;
};

export const tokenizeLine = (text: string) => {
  let i = 0;
  let buffer = '';
  let state: 'inString' | 'default' = 'default';
  let tokenStart = 0;

  let result: Array<Token> = [];

  const flush = (endCol: number) => {
    if (buffer.length === 0) return;
    result.push({
      kind: state === 'inString' ? 'string' : 'ident',
      text: buffer,
      startCol: tokenStart,
      endCol,
    });
    buffer = '';
  };

  while (i < text.length) {
    let char = text[i];
    if (state === 'inString') {
      buffer += char;
      if (char === "'" || char === '"') {
        result.push({
          kind: 'string',
          text: buffer,
          startCol: tokenStart,
          endCol: i + 1,
        });
        buffer = '';
        state = 'default';
      }

      i++;
      continue;
    }
    // if not in string
    switch (char) {
      case ' ':
      case '\n':
      case '\t':
      case '\r': {
        flush(i);
        i++;
        continue;
      }
      case ',': {
        flush(i);
        result.push({
          kind: 'comma',
          startCol: i,
          endCol: i + 1,
          text: ',',
        });

        i++;
        continue;
      }
      case "'":
      case '"': {
        state = 'inString';
        buffer = '';
        tokenStart = i;
        buffer += char;
        i++;
        continue;
      }
    }
    if (buffer.length === 0) {
      tokenStart = i;
    }
    buffer += char;
    i++;
  }

  flush(i);

  return result;
};
