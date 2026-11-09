# Central de Notas Fiscais — Costalog

Primeira versão da interface administrativa para organizar NF-e recebidas pela Costalog.

## Funcionalidades do frontend
- Dashboard com indicadores calculados a partir das notas.
- Importação de múltiplos XMLs de NF-e (NFe / procNFe).
- Leitura local de emitente, destinatário, número, série, emissão, chave, total, formas de pagamento e itens.
- Listagem, filtros, produtos e agrupamento de fornecedores.
- Layout responsivo com identidade visual vermelha e branca.
- Quando a API estiver ativa, a interface carrega as notas do banco e grava novas importações.

## Backend preparado
- API Node.js / Express em `server/`.
- PostgreSQL via Neon, com tabelas de notas, fornecedores e produtos.
- Rotas de consulta e importação.
- Inicialização automática do schema.
- Deploy preparado pelo `render.yaml` (Render Blueprint).

## Limitações e segurança
O acesso permanece **aberto e sem login**, conforme solicitado nesta etapa. A API é pública: CORS não substitui autenticação. Não use XMLs reais nem dados fiscais confidenciais até implementar controle de acesso. O XML original não é guardado pelo backend; apenas campos estruturados e produtos extraídos são persistidos.

Antes da configuração do Neon e do Render, a interface funciona em modo local e os dados importados permanecem somente na memória da sessão.

## Publicação pelo GitHub Actions

O workflow em .github/workflows/pages.yml publica o conteúdo do repositório no GitHub Pages quando houver push na branch main. Em Settings → Pages, selecione **GitHub Actions** como fonte, caso ainda não esteja selecionado.

## Arquitetura planejada

- Frontend: GitHub Pages.
- Backend: Node.js (serviço separado).
- Banco: PostgreSQL gerenciado.
- Acesso nesta fase: aberto, sem login; autenticação será adicionada quando solicitada.
- Integração fiscal: Distribuição DF-e, certificado e-CNPJ ICP-Brasil, controle de NSU e tratamento de manifestação do destinatário conforme regras fiscais.

O certificado digital deverá ficar exclusivamente no ambiente seguro do backend, nunca no navegador ou no repositório.

## Próximas etapas

1. Validar a leitura com XMLs de teste sem dados pessoais reais.
2. Definir domínio/URL e provedor do backend.
3. Conectar Neon e Render e validar a persistência.
4. Testar importação, duplicidade e consultas.
5. Implementar autenticação e controles de acesso quando a empresa decidir restringir o sistema.
6. Implementar integração fiscal após disponibilização do certificado e-CNPJ.


## Configuração Render + Neon
1. Crie um projeto PostgreSQL no Neon.
2. No Neon, clique em **Connect**, selecione branch, database e role, e copie a connection string mantendo `sslmode=require` e `channel_binding=require` quando disponíveis.
3. No Render, crie um Blueprint a partir deste repositório e selecione `render.yaml`.
4. Ao criar o serviço, informe a variável secreta `DATABASE_URL` com a connection string do Neon. Não a grave no GitHub.
5. A URL prevista da API será `https://central-notas-fiscais-costalog-api.onrender.com`. Confira a URL real no painel do Render; se for diferente, atualize `API_BASE_URL` no `index.html`.
6. Acesse `/health` na URL da API. O campo `databaseConnected` deverá retornar `true`.

O Render executa o serviço a partir de `server/`, definida em `render.yaml`. O plano Free pode apresentar inicialização mais lenta após períodos sem uso.
