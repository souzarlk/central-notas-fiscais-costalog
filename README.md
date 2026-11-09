# Central de Notas Fiscais — Costalog

Primeira versão da interface administrativa para organizar NF-e recebidas pela Costalog.

## O que existe nesta versão

- Dashboard com indicadores calculados a partir dos XMLs importados.
- Importação de múltiplos XMLs de NF-e (NFe / procNFe).
- Leitura local de emitente, destinatário, número, série, emissão, chave, total, formas de pagamento e itens.
- Listagem, filtros, produtos e agrupamento de fornecedores.
- Layout responsivo com identidade visual vermelha e branca.

## Limitações importantes

Esta é uma **versão inicial de demonstração**. O processamento ocorre no navegador e os dados ficam somente na memória da sessão. Ao atualizar ou fechar a página, os dados importados são perdidos.

Ainda não existe:
- autenticação administrativa real;
- banco de dados;
- backend;
- consulta automática à SEFAZ / Distribuição DF-e;
- armazenamento de XMLs ou DANFEs;
- manifestação do destinatário.

**Não use XMLs reais ou dados fiscais confidenciais enquanto este repositório estiver público e a aplicação não tiver backend e controle de acesso.** Não coloque certificados, senhas, tokens ou chaves em arquivos do GitHub.

## Publicação pelo GitHub Actions

O workflow em .github/workflows/pages.yml publica o conteúdo do repositório no GitHub Pages quando houver push na branch main. Em Settings → Pages, selecione **GitHub Actions** como fonte, caso ainda não esteja selecionado.

## Arquitetura planejada

- Frontend: GitHub Pages.
- Backend: Node.js (serviço separado).
- Banco: PostgreSQL gerenciado.
- Autenticação: sessão segura no backend, perfis Administrador/T.I.
- Integração fiscal: Distribuição DF-e, certificado e-CNPJ ICP-Brasil, controle de NSU e tratamento de manifestação do destinatário conforme regras fiscais.

O certificado digital deverá ficar exclusivamente no ambiente seguro do backend, nunca no navegador ou no repositório.

## Próximas etapas

1. Validar a leitura com XMLs de teste sem dados pessoais reais.
2. Definir domínio/URL e provedor do backend.
3. Criar banco privado e autenticação.
4. Implementar upload seguro e persistência.
5. Implementar integração fiscal após disponibilização do certificado e-CNPJ.
