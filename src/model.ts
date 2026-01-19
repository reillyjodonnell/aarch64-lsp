// General idea = hold the structure

import type { TextDocument } from 'vscode-languageserver-textdocument';
import { tokenizeDocument, type Token } from './tokenizer';
import { getHintsFromTokens } from './analyzer';

// uri + version : {text: ""}

const structure: Record<string, { tokens: Record<number, Array<Token>> }> = {};

export const Model = {
  handleSync: (e: { document: TextDocument }) => {
    const text = e.document.getText();
    const tokens = tokenizeDocument(text);
    structure[e.document.uri] = {
      tokens,
    };
  },

  getTokensForFileByUri: (uri: string) => {
    const res = structure[uri];
    if (!res) return [];

    return getHintsFromTokens(res.tokens);
  },
};
