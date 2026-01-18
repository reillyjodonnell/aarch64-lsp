import { LanguageClient, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate() {
  const serverPath =
    '/Users/reilly/programming/experiments/aarch64-lsp/src/server.ts';

  client = new LanguageClient(
    'aarch64-lsp',
    'AArch64 LSP',
    {
      command: 'bun',
      args: ['run', serverPath, '--stdio'],
      transport: TransportKind.stdio,
    },
    {
      documentSelector: [{ scheme: 'file', language: 'aarch64' }],
    },
  );

  client.start();
}

export function deactivate() {
  return client?.stop();
}
