const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { buildRequest, parseResponse, parseInvoice, decompress } = require('../src/sefaz');

test('buildRequest cria consulta distNSU com NSU de 15 dígitos', () => {
  const xml = buildRequest({
    cnpj: '13824759000130',
    tpAmb: '1',
    cUfAutor: '35'
  }, '0');
  assert.match(xml, /<distNSU><ultNSU>000000000000000<\/ultNSU><\/distNSU>/);
  assert.match(xml, /<CNPJ>13824759000130<\/CNPJ>/);
  assert.match(xml, /<tpAmb>1<\/tpAmb>/);
});

test('parseResponse identifica cStat 137 sem documentos', () => {
  const xml = '<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>1</tpAmb><cStat>137</cStat><xMotivo>Nenhum documento localizado</xMotivo><ultNSU>000000000000010</ultNSU><maxNSU>000000000000010</maxNSU></retDistDFeInt>';
  const result = parseResponse(xml);
  assert.equal(result.status, '137');
  assert.equal(result.ultNsu, '000000000000010');
  assert.deepEqual(result.docs, []);
});

test('parseInvoice interpreta resumo de NF-e recebido pela distribuição', () => {
  const key = '35261113824759000130550010000012341000012345';
  const xml = '<resNFe xmlns="http://www.portalfiscal.inf.br/nfe"><chNFe>' + key + '</chNFe><CNPJ>11222333000144</CNPJ><xNome>Fornecedor Teste</xNome><vNF>123.45</vNF><dhEmi>2026-11-09T10:00:00-03:00</dhEmi></resNFe>';
  const result = parseInvoice(xml, '13824759000130');
  assert.equal(result.key, key);
  assert.equal(result.supplier, 'Fornecedor Teste');
  assert.equal(result.total, 123.45);
  assert.equal(result.complete, false);
  assert.equal(result.status, 'Resumo SEFAZ — manifestação pendente');
});

test('decompress restaura XML GZip enviado no docZip', () => {
  const source = '<resNFe><xNome>Teste</xNome></resNFe>';
  const compressed = zlib.gzipSync(Buffer.from(source)).toString('base64');
  assert.equal(decompress(compressed), source);
});
