# API — Central de Notas Fiscais Costalog

API Node.js + Express + PostgreSQL (Neon).

## Rotas
- `GET /health`: estado da API e do banco.
- `GET /api/invoices`: lista as notas cadastradas.
- `POST /api/invoices`: grava uma NF-e e seus produtos.
- `GET /api/products`: lista produtos.
- `GET /api/suppliers`: lista fornecedores.

## Desenvolvimento
1. Instale Node.js 20 ou superior.
2. Copie `.env.example` para `.env` e preencha DATABASE_URL.
3. Execute `npm install`.
4. Execute `npm start`.

O schema é criado automaticamente no primeiro início, desde que DATABASE_URL esteja configurada.

## Segurança nesta fase
O acesso está deliberadamente sem autenticação, conforme decisão do projeto. A API é pública. CORS não substitui autenticação nem bloqueia chamadas por ferramentas externas. Use somente XMLs de teste; não armazene documentos fiscais reais até adicionar autenticação e controles de acesso.
O XML original não é persistido; apenas campos estruturados e itens extraídos são gravados.
