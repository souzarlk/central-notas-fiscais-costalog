# Central de Gestão Fiscal — Costalog

Plataforma interna da Costalog para organizar documentos fiscais, compras, fornecedores e obrigações financeiras. A interface mantém a identidade visual Costalog, com modo claro/escuro e três áreas de trabalho: Geral, Compras e Fiscal.

## Módulos disponíveis

### Geral
- Painel consolidado.
- Gestão de pagamentos e contas a pagar (controle interno).
- Cadastro de boletos e associação manual a NF-e.
- Painel de conferência de boletos recebidos; DDA bancário depende de convênio/credenciais.
- Biblioteca fiscal para XMLs armazenados.
- Automações configuráveis (as regras são armazenadas; execução externa depende de conectores).
- Relatórios CSV e fechamento mensal.
- Livro de dados com linha do tempo documental.
- Leitura estrutural inicial de arquivo CNAB; geração e retorno bancário homologados dependem do banco.

### Compras
- Pedidos e contratos.
- Conferência de valor de pedido versus NF-e vinculada.
- Negociações e pendências com fornecedores.
- Visão de fornecedores identificados nos documentos.

### Fiscal
- Documentos: NF-e, NFS-e, CT-e, CT-e OS, CF-e SAT, NFC-e e MDF-e.
- NF-e em etapas (kanban interno).
- Filtros por tipo, data, papel documental e situação.
- Exportação CSV, comentários e etiquetas.
- Consulta individual de NF-e por chave e distribuição automática por NSU.
- Relatórios de CT-e/CT-e OS, indicadores fiscais, preparação SPED e controle de devoluções/manifestações.

## Importação e armazenamento

- Importação de XML/ZIP.
- A NF-e é registrada na estrutura de notas e itens.
- NFS-e, CT-e, CT-e OS, CF-e SAT, NFC-e e MDF-e reconhecidos são registrados em tabela própria, mantendo o XML original para download autenticado.
- Duplicidade é controlada pela chave do documento ou hash do XML quando o leiaute não fornece chave.
- O sistema não inventa dados ausentes no XML.

## Integração e limitações importantes

- Frontend: GitHub Pages.
- API: Node.js / Express no Render.
- Banco: PostgreSQL no Neon.
- A distribuição automática da SEFAZ nesta versão consulta NF-e; os demais tipos entram via XML/ZIP ou integração específica.
- DDA, conexão bancária, pagamentos efetivos, CNAB completo/homologado, ERP, captura automática de NFS-e, tratamento fiscal avançado de SPED e manifestação de destinatário exigem integração externa, credenciais, layouts e validação da empresa.
- Recursos que dependam desses serviços são identificados como dependentes de integração; a Central não movimenta dinheiro e não executa eventos fiscais automaticamente.
- A implementação inspira-se em práticas comuns de plataformas fiscais/financeiras, mas mantém a marca e o design próprios da Costalog; não é uma cópia do código ou das telas proprietárias de terceiros.

## Publicação

- .github/workflows/pages.yml: publica o frontend no GitHub Pages.
- .github/workflows/validate-api.yml: verifica sintaxe e executa testes da API.
- Render executa a API conforme render.yaml; variáveis privadas devem ficar somente no painel do Render.
