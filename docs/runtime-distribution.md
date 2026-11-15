# Distribuição do Runtime

Cada push em `main` gera uma GitHub Release de pré-lançamento imutável, marcada
como `runtime-main-<SHA completo>`. Ela possui três ativos:

- `thinkiac-runtime-main-<SHA>.zip`: fonte rastreada do Runtime e `runtime.json`;
- `runtime-manifest.json`: contrato para consumidores, versão, commit, tamanho e
  SHA-256 do ZIP;
- `checksums.txt`: checksum verificável pelo consumidor.

O ZIP Windows contém `node.exe` e `node_modules` prontos para Windows x64. Não
contém dados de usuário, caches ou segredos. O Desktop valida o SHA-256, extrai o
asset e executa `node/node.exe index.js`, sem usar npm no computador do usuário.

## Consumidor Electron

O bootstrapper Electron deve escolher uma release explícita, baixar primeiro
`runtime-manifest.json`, validar o SHA-256 do ZIP, extrair em um diretório
versionado e descartável, instalar ou fornecer o runtime Windows compatível e
iniciar `node index.js`. Dados persistentes e logs ficam fora do diretório
extraído. Só depois de `GET /__ready` ele abre o endereço localhost.

Não use `git clone`, `main` em tempo de execução nem um ZIP sem checksum. Para
produção estável, promova uma release por tag semântica usando o mesmo formato
de manifesto; a release automática de `main` serve como canal contínuo.

## Produção manual

Para gerar localmente:

```bash
npm run package:runtime -- --version 1.2.3 --output dist/runtime
```

O comando imprime os caminhos gerados e o SHA-256. Antes de publicar, valide:

```bash
unzip -t dist/runtime/*.zip
(cd dist/runtime && sha256sum --check checksums.txt)
```
