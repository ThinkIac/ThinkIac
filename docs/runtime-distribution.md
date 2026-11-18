# Distribuição do Runtime

O workflow **Release runtime** publica uma pré-release `runtime-main-<SHA>`
quando o pacote passa pelo teste de inicialização no Windows x64. A release
inclui `thinkiac-runtime-win-x64-<versão>.zip`, `runtime-manifest.json`
(schema 2) e `checksums.txt`. O teste extrai o ZIP em um diretório temporário,
usa o `node.exe` do pacote e verifica o login, a criação da primeira conta e
a abertura do shell.

## Consumidor Electron

O build do Desktop incorpora o ZIP Windows com checksum validado. Na primeira
abertura, o app verifica e extrai o ZIP em um diretório versionado. Nas aberturas
seguintes, reutiliza a instalação local, preservando o cache de compilação. O
Electron espera o JSON de `GET /__ready` em loopback e abre a página local de
login. Os bancos gerenciados pelo Lógos usam o diretório de dados do aplicativo.

## Produção manual

Para gerar o ZIP de código-fonte localmente (manifesto schema 1):

```bash
npm run package:runtime -- --version 1.2.3 --output dist/runtime
```

O comando imprime os caminhos gerados e o SHA-256. Antes de publicar, valide:

```bash
unzip -t dist/runtime/*.zip
(cd dist/runtime && sha256sum --check checksums.txt)
```
