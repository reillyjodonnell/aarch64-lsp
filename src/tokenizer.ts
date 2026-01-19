export type TokenKind = 'ident' | 'comma' | 'comment' | 'string';

export type Token = {
  kind: TokenKind;
  text: string;
  startCol: number;
  endCol: number;
};

export const tokenizeLine = (text: string) => {
  let i = 0;
  let buffer = '';
  let quote: '"' | "'" | null = null;
  let tokenKind: TokenKind = 'ident';
  let tokenStart = 0;

  let result: Array<Token> = [];

  const flush = (endCol: number) => {
    if (buffer.length === 0) return;
    result.push({
      kind: tokenKind,
      text: buffer,
      startCol: tokenStart,
      endCol,
    });
    buffer = '';
    tokenKind = 'ident';
  };

  while (i < text.length) {
    let char = text[i];
    // if we're in a string
    if (quote !== null) {
      buffer += char;
      if (char === "'" || char === '"') {
        quote = null;
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

        // emit comma token
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
        quote = char;
        tokenKind = 'string';
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
