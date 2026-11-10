# API — Central de Notas Fiscais Costalog

API Node.js + Express + PostgreSQL (Neon), com autenticação administrativa e integração de distribuição DF-e da NF-e.

## Rotas principais

- GET /health — saúde da API e conexão ao banco; pública, sem dados fiscais.
- POST /api/auth/login e GET /api/auth/me — autenticação administrativa.
- GET /api/invoices, POST /api/invoices, POST /api/invoices/import-batch — NF-e, consulta e importação em lote.
- GET /api/invoices/export.csv — exportação de NF-e.
- GET /api/fiscal-documents — documentos fiscais por tipo.
- POST /api/fiscal-documents/import-batch — importação de XMLs de NFS-e, CT-e, CT-e OS, CF-e SAT, NFC-e e MDF-e.
- GET /api/fiscal-documents/:id/xml — download do XML fiscal armazenado.
- GET/POST/PATCH/DELETE /api/workspace/records — registros dos ambientes Geral, Compras e Fiscal.
- GET/POST /api/annotations e DELETE /api/annotations/:id — comentários e etiquetas vinculados a documentos.
- GET /api/products e GET /api/suppliers — dados extraídos das notas.
- GET /api/sefaz/status, POST /api/sefaz/lookup-key e POST /api/sefaz/sync — integração SEFAZ.

As rotas de dados exigem Authorization: Bearer com sessão administrativa, exceto /health. A rota de sincronização SEFAZ utiliza o token técnico próprio.

## Estrutura de dados

- invoices e invoice_products: NF-e completas e itens extraídos.
- suppliers: cadastro consolidado de emitentes.
- fiscal_documents: documentos fiscais adicionais, com XML original protegido e detalhes estruturados.
- workspace_records: registros de contas, boletos, pedidos, negociações, automações e etapas documentais.
- document_annotations: comentários e etiquetas.
- sefaz_sync_state e sefaz_processed_documents: sequência NSU e documentos entregues pela distribuição.
- sefaz_key_lookups: trilha de consultas individuais por chave.

O schema é criado/verificado no startup da API. O Render precisa concluir o deploy para que as novas tabelas e rotas fiquem disponíveis.

## Acesso e segurança

Configure exclusivamente no ambiente privado do Render:

- DATABASE_URL
- ADMIN_USERNAME
- ADMIN_PASSWORD
- ADMIN_AUTH_SECRET (segredo aleatório com pelo menos 32 bytes)
- SEFAZ_ENABLED, SEFAZ_CERT_BASE64, SEFAZ_CERT_PASSWORD, SEFAZ_CNPJ, SEFAZ_TP_AMB, SEFAZ_CUFAUTOR
- COSTALOG_SYNC_TOKEN

Nunca coloque senha, certificado PFX/Base64, segredo de sessão, token ou connection string no HTML, no GitHub ou em logs. O XML original de documentos adicionais fica guardado no banco e só pode ser baixado por sessão autenticada.

A sessão administrativa usa token HMAC-SHA256 com validade de 12 horas e o login possui limite de tentativas.

## Escopo funcional e integrações externas

- A distribuição automática distNSU está conectada para NF-e disponibilizada à Costalog pela SEFAZ. Não garante histórico anterior à janela de distribuição.
- NFS-e, CT-e, CT-e OS, CF-e SAT, NFC-e e MDF-e podem ser importados por XML/ZIP. Esta versão não realiza captura automática desses modelos em seus ambientes oficiais.
- Contas a pagar, boletos, associação de boleto a NF-e, pedidos, conferência de valores, negociações, etapas e relatórios básicos são controles internos da Central.
- DDA, integração bancária, execução de pagamentos, geração/retorno CNAB homologado, integração ERP, processamento fiscal avançado do SPED e eventos de manifestação dependem de conectores, credenciais, layouts bancários/fiscais e homologação. A Central não movimenta recursos bancários nem envia manifestação do destinatário automaticamente.
- A pré-verificação CNAB da interface verifica apenas a largura das linhas (240/400 caracteres); não é parser bancário nem validação de arquivo para transmissão.
- A análise Tax atual apresenta indicadores e rankings baseados nos documentos armazenados; não substitui apuração tributária validada.

## Desenvolvimento

Node.js 20+. Na pasta server, execute npm install, npm test e npm start.
