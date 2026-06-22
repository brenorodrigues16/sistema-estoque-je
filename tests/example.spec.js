
// @ts-nocheck
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3000';

// =============================================================
//  BLOCO 1 - CONECTIVIDADE
// =============================================================
test('banco de dados conectado', async ({ request }) => {
  const res = await request.get(`${BASE}/api/teste-db`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe('Conectado!');
});

// =============================================================
//  BLOCO 2 - CHAPAS
// =============================================================
test('listar chapas retorna array', async ({ request }) => {
  const res = await request.get(`${BASE}/api/chapas`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBeTruthy();
});

test('cadastrar chapa com sucesso', async ({ request }) => {
  const res = await request.post(`${BASE}/api/chapas`, {
    data: { onda: 'BC', fornecedor: 'Teste Auto', comprimento: 2000, largura: 1000, quantidade: 10 }
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.success).toBeTruthy();
});

test('cadastrar chapa sem campos obrigatorios retorna erro', async ({ request }) => {
  const res = await request.post(`${BASE}/api/chapas`, {
    data: { onda: 'BC' }
  });
  expect(res.status()).toBe(400);
});

test('verificar estoque retorna numero', async ({ request }) => {
  const res = await request.get(`${BASE}/api/verificar-estoque?tipo=BC&largura=1000&comprimento=2000`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(typeof body.estoque).toBe('number');
});

test('verificar estoque de chapa inexistente retorna zero', async ({ request }) => {
  const res = await request.get(`${BASE}/api/verificar-estoque?tipo=ONDA_XYZ&largura=9999&comprimento=9999`);
  const body = await res.json();
  expect(body.estoque).toBe(0);
});

test('tipos de onda retorna array', async ({ request }) => {
  const res = await request.get(`${BASE}/api/tipos-onda`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBeTruthy();
});

// =============================================================
//  BLOCO 3 - PRODUCAO
// =============================================================
test('produzir sem campos obrigatorios retorna erro', async ({ request }) => {
  const res = await request.post(`${BASE}/api/produzir`, { data: {} });
  expect(res.status()).toBe(400);
});

test('produzir com estoque insuficiente retorna erro claro', async ({ request }) => {
  const res = await request.post(`${BASE}/api/produzir`, {
    data: {
      cliente: 'Teste',
      referencia: 'REF-001',
      tipo_onda: 'ONDA_INEXISTENTE',
      largura_chapa: 9999,
      comprimento_chapa: 9999,
      qtd_chapas_necessarias: 999999,
      qtd_programada: 100,
      medida: '30x20'
    }
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.success).toBeFalsy();
  expect(body.message).toBeTruthy();
});

test('listar pedidos recentes retorna array', async ({ request }) => {
  const res = await request.get(`${BASE}/api/pedidos-recentes`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBeTruthy();
});

test('conferir pedido inexistente retorna erro claro', async ({ request }) => {
  const res = await request.post(`${BASE}/api/conferir-pedido`, {
    data: { id: 999999999, qtd_conferida: 10, responsavel: 'Teste' }
  });
  expect(res.status()).toBe(404);
  const body = await res.json();
  expect(body.success).toBeFalsy();
  expect(body.message).toBeTruthy();
});

// =============================================================
//  BLOCO 4 - CAIXAS
// =============================================================
test('listar caixas retorna array', async ({ request }) => {
  const res = await request.get(`${BASE}/api/caixas`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBeTruthy();
});

test('cadastrar e deletar caixa', async ({ request }) => {
  const criou = await request.post(`${BASE}/api/registrar-caixa`, {
    data: {
      cliente: 'TESTE AUTO',
      codigo: 'DEL-TESTE-001',
      quantidade: 5,
      data_fabricacao: new Date().toISOString(),
      responsavel: 'Sistema'
    }
  });
  expect(criou.status()).toBe(200);

  const lista = await request.get(`${BASE}/api/caixas`);
  const caixas = await lista.json();
  const caixa = caixas.find(c => c.codigo === 'DEL-TESTE-001');
  expect(caixa).toBeTruthy();

  const deletou = await request.delete(`${BASE}/api/caixas/${caixa.id}`);
  expect(deletou.status()).toBe(200);
  const body = await deletou.json();
  expect(body.success).toBeTruthy();
});

test('deletar caixa com id inexistente retorna 404', async ({ request }) => {
  const res = await request.delete(`${BASE}/api/caixas/999999999`);
  expect(res.status()).toBe(404);
});

test('ajustar estoque nao permite quantidade negativa', async ({ request }) => {
  const criou = await request.post(`${BASE}/api/registrar-caixa`, {
    data: {
      cliente: 'TESTE NEGATIVO',
      codigo: 'NEG-001',
      quantidade: 5,
      data_fabricacao: new Date().toISOString(),
      responsavel: 'Sistema'
    }
  });

  const lista = await request.get(`${BASE}/api/caixas`);
  const caixas = await lista.json();
  const caixa = caixas.find(c => c.codigo === 'NEG-001');

  const res = await request.post(`${BASE}/api/ajustar-estoque`, {
    data: { id: caixa.id, mudanca: -99999 }
  });
  expect(res.status()).toBe(400);

  await request.delete(`${BASE}/api/caixas/${caixa.id}`);
});

// =============================================================
//  BLOCO 5 - DASHBOARD
// =============================================================
test('dashboard-stats retorna todos os campos', async ({ request }) => {
  const res = await request.get(`${BASE}/api/dashboard-stats`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('estoqueChapas');
  expect(body).toHaveProperty('estoqueCaixas');
  expect(body).toHaveProperty('producaoHoje');
  expect(body).toHaveProperty('alertasCriticosChapas');
  expect(body).toHaveProperty('alertasCriticosCaixas');
});

test('resumo-hoje retorna total de caixas e fila', async ({ request }) => {
  const res = await request.get(`${BASE}/api/resumo-hoje`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(typeof body.total_caixas).toBe('number');
  expect(typeof body.fila_pedidos).toBe('number');
});

// =============================================================
//  BLOCO 6 - MOVIMENTACOES E ENTRADAS
// =============================================================
test('listar movimentacoes retorna array', async ({ request }) => {
  const res = await request.get(`${BASE}/api/movimentacoes`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBeTruthy();
});

test('registrar entrada de chapa com sucesso', async ({ request }) => {
  const res = await request.post(`${BASE}/api/registrar-entrada`, {
    data: {
      onda: 'BC',
      comprimento: 2000,
      largura: 1000,
      fornecedor: 'Fornecedor Teste',
      quantidade: 5,
      usuario: 'Teste Auto'
    }
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.success).toBeTruthy();
});

test('registrar entrada sem campos obrigatorios retorna erro', async ({ request }) => {
  const res = await request.post(`${BASE}/api/registrar-entrada`, { data: {} });
  expect(res.status()).toBe(400);
});

// =============================================================
//  BLOCO 7 - AUTENTICACAO
// =============================================================
test('login com usuario inexistente retorna 401', async ({ request }) => {
  const res = await request.post(`${BASE}/api/login`, {
    data: { usuario: 'usuario_xyz_inexistente', senha: 'qualquer' }
  });
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.success).toBeFalsy();
});

test('login com body vazio retorna 401', async ({ request }) => {
  const res = await request.post(`${BASE}/api/login`, { data: {} });
  expect(res.status()).toBe(401);
});

test('logs admin sem senha retorna 403', async ({ request }) => {
  const res = await request.get(`${BASE}/api/admin/logs`);
  expect(res.status()).toBe(403);
});

test('logs admin com senha errada retorna 403', async ({ request }) => {
  const res = await request.get(`${BASE}/api/admin/logs?senha=errada`);
  expect(res.status()).toBe(403);
});

// =============================================================
//  BLOCO 8 - SAIDAS
// =============================================================
test('listar saidas retorna array', async ({ request }) => {
  const res = await request.get(`${BASE}/api/saidas`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBeTruthy();
});

test('registrar carga com codigo inexistente retorna erro claro', async ({ request }) => {
  const res = await request.post(`${BASE}/api/registrar-carga`, {
    data: {
      caminhao: 'ABC-1234',
      itens: [{ codigo: 'COD-INEXISTENTE-XYZ', quantidade: 1 }]
    }
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.error).toBeTruthy();
});