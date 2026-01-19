// General idea = hold the structure

import type { TextDocument } from 'vscode-languageserver-textdocument';
import { tokenizeDocument, type Token } from './tokenizer';
import { getHintsFromTokens } from './analyzer';

// uri + version : {text: ""}

const structure: Record<
  string,
  { tokensByLine: Record<number, Array<Token>> }
> = {};

export const Model = {
  handleSync: (e: { document: TextDocument }) => {
    const text = e.document.getText();
    const tokensByLine = tokenizeDocument(text);
    structure[e.document.uri] = {
      tokensByLine,
    };
  },

  getTokensForFileByUri: (uri: string) => {
    const res = structure[uri];
    if (!res) return [];

    return getHintsFromTokens(res.tokensByLine);
  },
};
