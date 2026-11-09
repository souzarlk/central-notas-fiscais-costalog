# API — Central de Notas Fiscais Costalog

API Node.js + Express + PostgreSQL (Neon), com integração de Distribuição DF-e da NF-e.

## Rotas
- GET /health
- GET /api/invoices
- POST /api/invoices (importação manual de XML)
- GET /api/products
- GET /api/suppliers
- GET /api/sefaz/status
- POST /api/sefaz/sync (protegida por Bearer token)

## Integração SEFAZ
A API consulta o serviço nacional NFeDistribuicaoDFe usando distNSU e certificado digital A1 com autenticação TLS mútua. O NSU fica salvo no PostgreSQL. Os documentos são processados em transação; o cursor só avança após persistir cada lote. O XML original não é armazenado.

A rotina limita cada execução a 10 lotes (até 50 documentos por lote), faz intervalo entre lotes e respeita pelo menos uma hora entre consultas quando não há novos documentos ou quando ocorre cStat 656. O workflow .github/workflows/sefaz-sync.yml chama a API de hora em hora e também aceita execução manual no GitHub Actions.

A aplicação não envia manifestação do destinatário automaticamente. Antes da manifestação, a SEFAZ pode disponibilizar somente o resumo; o XML completo exige manifestação válida.

## Configuração segura no Render
1. Revogue o certificado anterior que foi exposto e obtenha um NOVO certificado A1.
2. No computador da empresa, codifique o novo PFX em Base64 com PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\caminho\novo-certificado.pfx'))`.
3. Copie a saída diretamente para Render → serviço da API → Environment como `SEFAZ_CERT_BASE64`. Não envie esse conteúdo ao ChatGPT nem ao GitHub.
4. Configure `SEFAZ_CERT_PASSWORD` somente em Environment do Render.
5. Configure `SEFAZ_CNPJ` com o CNPJ completo da empresa, sem pontuação.
6. Configure `SEFAZ_CUFAUTOR=35`, `SEFAZ_TP_AMB=1` e `SEFAZ_DISTRIBUTION_URL` com o endpoint oficial.
7. Gere um token longo e aleatório e cadastre o mesmo valor como `COSTALOG_SYNC_TOKEN` no Render e em GitHub → Settings → Secrets and variables → Actions.
8. Confirme que `/api/sefaz/status` mostra certificado e token configurados. Só então altere `SEFAZ_ENABLED=true` e faça o deploy.
9. Execute o workflow manualmente em GitHub → Actions → Sincronização automática de NF-e da Costalog.

Nunca grave o arquivo PFX, o Base64, a senha, a connection string ou o token no GitHub, no frontend, em arquivos versionados ou logs.

## Regras e limites
- A distribuição é por NSU do interessado; a primeira consulta não garante histórico completo anterior à ativação.
- A recuperação tem janela regulatória limitada e a sequência precisa ser mantida continuamente.
- Para destinatário, o XML completo pode exigir manifestação de destinatário. A aplicação apenas sincroniza os documentos entregues pelo serviço e não confirma operação automaticamente.
- Eventos de manifestação e cancelamento ainda não têm tratamento fiscal completo nesta primeira entrega; documentos não reconhecidos são registrados como processados para preservar a sequência.
- A API ainda está sem autenticação nas rotas gerais de leitura e gravação. O token protege somente a rotina de sincronização. Não utilize dados fiscais reais até implementar autenticação/autorização para todas as rotas.

## Desenvolvimento local
Node.js 20+. Execute npm install e npm start. O schema é preparado automaticamente ao iniciar se DATABASE_URL estiver definida.
