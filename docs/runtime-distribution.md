# Distribuição do Runtime

Cada push em `main` publica uma release prévia do Runtime Windows.

## Assets

- `thinkiac-runtime-win-x64-<versão>.zip`: Runtime completo para Windows x64.
- `runtime-manifest.json`: contrato consumido pelos distribuidores.
- `checksums.txt`: SHA-256 do ZIP.

O ZIP contém `node.exe`, `node_modules` instalados no runner Windows e o código
do Runtime. Não contém dados do usuário, `.env`, caches, logs ou diretórios Git.
O consumidor deve extrair o ZIP em um diretório descartável, manter os dados em
um diretório persistente separado e verificar o SHA-256 antes de iniciar
`node/node.exe index.js`.

O Desktop consulta o manifesto da release mais recente, baixa somente o asset
`win32-x64` e nunca executa `npm install` na máquina do usuário.
