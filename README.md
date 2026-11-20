# ThinkIac

ThinkIac é uma plataforma modular para executar agentes, automações e aplicações como infraestrutura. A interface web reúne chat, ferramentas, terminal e arquivos. Os pacotes e módulos ampliam o ambiente com novas interfaces, serviços e integrações.

<img width="720" alt="Interface web do ThinkIac" src="https://github.com/user-attachments/assets/215e73db-7f0a-46fd-a081-0500156a83be" />

## Como funciona

O **Lógos** descobre os pacotes, gerencia seu ciclo de vida e conecta seus serviços por eventos. Um pacote pode publicar rotas HTTP, disponibilizar ferramentas para agentes, adicionar telas à interface ou configurar seu próprio banco de dados.

Os agentes usam os provedores de IA configurados na instância. Especialistas podem ser ativados sob demanda ou por condições declaradas, conforme a tarefa. Na interface, os pacotes podem adicionar itens de menu, widgets no chat e páginas de configuração. Consulte os [contratos de integração do runtime](vendor/packages/logos/docs/package-integrations.md).

## Comece a usar

### Docker Compose

```bash
git clone https://github.com/ThinkIac/ThinkIac.git
cd ThinkIac
cp .env.example .env
```

Em `.env`, defina `INITIAL_AUTH_USER`, `INITIAL_AUTH_EMAIL` e `INITIAL_AUTH_PASSWORD` e configure o provedor de IA. Proteja o arquivo com `chmod 600 .env`. Depois, inicie a instância:

```bash
docker compose up -d --build
```

Abra [a página de login](http://localhost:5040/view/auth/Login). O Compose guarda os dados no volume `thinkiac_data`. Depois de criar o administrador, siga o [guia de provisionamento](packages/auth/BOOTSTRAP.md) para remover as credenciais iniciais.

### VPS

Em Debian ou Ubuntu com `systemd`, o instalador prepara o Node.js 22, instala o ThinkIac em `/opt/thinkiac` e inicia o serviço `thinkiac`.

```bash
curl -fsSL https://raw.githubusercontent.com/ThinkIac/ThinkIac/main/scripts/install.sh | sudo bash
```

O instalador salva as credenciais iniciais do administrador em `/opt/thinkiac/.env`. Após o primeiro acesso, remova essas credenciais conforme o [guia de provisionamento](packages/auth/BOOTSTRAP.md). Acesse `/view/auth/Login` na porta `5040` da VPS. Configure firewall e HTTPS antes de expor a instância à internet.

### Desenvolvimento local

Use Node.js 22.12 ou superior e configure o `.env` como na seção Docker Compose. No macOS, instale o Xcode Command Line Tools e o Python 3 se o npm precisar compilar módulos nativos. Em seguida, na raiz do projeto:

```bash
npm ci --legacy-peer-deps
npm run start:runtime
```

## Explore o ecossistema

Os pacotes podem ser revisados e instalados separadamente no workspace ativo. O catálogo reúne aplicativos, conectores e automações. Abra o README do pacote que você quer instalar para conferir seus requisitos, configuração e permissões.

[Ver pacotes do ThinkIac no GitHub](https://github.com/search?q=org%3AThinkIac+topic%3Athinkiac+topic%3Apackages+is%3Apublic&type=repositories)

## Desenvolva para o ThinkIac

Comece pelo `package.json` para declarar como seu pacote se integra ao runtime. A partir daí, use as referências conforme o que você quer construir:

- **Expor ferramentas, rotas ou eventos.** Consulte a [referência de decorators](docs/decorators.md), o [ciclo de execução dos agentes](packages/agent/README.md) e as [regras de classificação e roteamento de ferramentas](packages/classification/README.md).
- **Adicionar recursos à interface.** Veja os contratos de [menus e ícones](packages/shell/README.md), [widgets no chat](packages/agent/docs/package-widgets-and-ui-bus.md) e [configurações e credenciais](packages/settings/README.md).
- **Persistir dados ou isolar um serviço.** Veja como declarar [banco e isolamento](vendor/packages/logos/docs/package-integrations.md#banco-e-isolamento).
- **Empacotar e distribuir o runtime.** Consulte o [guia de distribuição](docs/runtime-distribution.md).

## Segurança e contribuições

O runtime pode acessar terminal, arquivos e credenciais conforme a configuração da instância. Revise as permissões dos pacotes antes de instalá-los e mantenha credenciais, sessões e dados locais fora do controle de versão. Para reportar uma vulnerabilidade, consulte a [política de segurança](SECURITY.md).

Para contribuir com código ou documentação, siga o [guia de contribuição](CONTRIBUTING.md).

## Licença e apoio

Os termos de licença e redistribuição serão publicados com a primeira versão estável. Quem quiser apoiar o desenvolvimento pode contribuir com qualquer valor em USDC na rede Polygon para `0x463712863f400dedc8f199d1dab9eb1fd7daf696`.
