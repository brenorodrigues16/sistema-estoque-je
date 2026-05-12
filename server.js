const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// --- ROTAS DO DASHBOARD ---
app.get('/dados', async (req, res) => {
    try {
        const totalRes = await db.query('SELECT SUM(quantidade) as total FROM chapas');
        const agrupadoRes = await db.query(`
            SELECT UPPER(TRIM(onda)) as onda, SUM(quantidade) as quantidade 
            FROM chapas 
            GROUP BY UPPER(TRIM(onda))
            ORDER BY quantidade DESC
        `);
        res.json({ 
            estoqueTotal: totalRes.rows[0].total || 0,
            chapas: agrupadoRes.rows 
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/fornecedores-completo', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM fornecedores ORDER BY nome ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/add-fornecedor', async (req, res) => {
    const { nome, contato } = req.body;
    try {
        await db.query('INSERT INTO fornecedores (nome, contato) VALUES ($1, $2)', [nome, contato]);
        res.json({ message: "Fornecedor cadastrado com sucesso!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/fornecedores', async (req, res) => {
    try {
        const result = await db.query('SELECT nome FROM fornecedores ORDER BY nome ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ROTAS DE CHAPAS ---
app.get('/chapas-detalhes', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM chapas ORDER BY onda ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/add-chapa', async (req, res) => {
    const { onda, comprimento, largura, quantidade, fornecedor } = req.body;
    try {
        await db.query(
            'INSERT INTO chapas (onda, comprimento, largura, quantidade, fornecedor) VALUES ($1, $2, $3, $4, $5)',
            [onda.trim().toUpperCase(), comprimento || 0, largura || 0, quantidade || 0, fornecedor || 'Geral']
        );
        res.json({ message: "Sucesso!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/ajustar-estoque', async (req, res) => {
    const { id, novaQuantidade, novoComprimento, novaLargura, novoFornecedor } = req.body;
    try {
        await db.query(
            'UPDATE chapas SET quantidade = $1, comprimento = $2, largura = $3, fornecedor = $4 WHERE id = $5',
            [novaQuantidade, novoComprimento, novaLargura, novoFornecedor, id]
        );
        res.json({ message: "Dados atualizados!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ROTAS DE CAIXAS PRONTAS ---

app.get('/caixas', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM caixas ORDER BY cliente ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ROTA DE BUSCA (ESTA É A QUE FALTAVA)
app.get('/buscar-caixas', async (req, res) => {
    const { termo } = req.query;
    try {
        const query = `
            SELECT * FROM caixas 
            WHERE codigo ILIKE $1 OR cliente ILIKE $1 
            ORDER BY cliente ASC`;
        const result = await db.query(query, [`%${termo}%`]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/add-caixa', async (req, res) => {
    const { codigo, medidas, quantidade, cliente } = req.body;
    try {
        const query = `
            INSERT INTO caixas (codigo, medidas, quantidade, cliente, data_fabricacao) 
            VALUES ($1, $2, $3, $4, NOW()) 
            RETURNING *`;
        const values = [codigo, medidas, quantidade, cliente];
        const result = await db.query(query, values);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/ajustar-estoque-caixa', async (req, res) => {
    const { id, ajuste, ehSubstituicao } = req.body;
    try {
        let query = ehSubstituicao 
            ? 'UPDATE caixas SET quantidade = $1 WHERE id = $2' 
            : 'UPDATE caixas SET quantidade = quantidade + $1 WHERE id = $2';
        await db.query(query, [ajuste, id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/editar-dados-caixa', async (req, res) => {
    const { id, cliente, codigo, medidas } = req.body;
    try {
        await db.query(
            'UPDATE caixas SET cliente = $1, codigo = $2, medidas = $3 WHERE id = $4',
            [cliente, codigo, medidas, id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/produzir', async (req, res) => {
    // Pegamos exatamente os nomes que o HTML está enviando
    const { cliente, tipo, largura, comprimento, quantidadeChapas, quantidadeCaixas, medidaCaixa } = req.body;

    try {
        await db.query('BEGIN');

        // IMPORTANTE: Usamos 'quantidadeChapas' para subtrair do estoque
        const queryEstoque = `
            UPDATE chapas 
            SET quantidade = quantidade - $1 
            WHERE TRIM(UPPER(onda)) = TRIM(UPPER($2)) 
              AND largura::numeric = $3::numeric 
              AND comprimento::numeric = $4::numeric
        `;
        
        // Verificação de segurança: se quantidadeChapas não chegar, o erro para aqui
        if (!quantidadeChapas || quantidadeChapas <= 0) {
            throw new Error("Quantidade de chapas inválida para o abatimento.");
        }

        const updateEstoque = await db.query(queryEstoque, [quantidadeChapas, tipo, largura, comprimento]);

        if (updateEstoque.rowCount === 0) {
            await db.query('ROLLBACK');
            return res.status(400).json({ message: "Chapa não encontrada no estoque para abatimento." });
        }

        // Registra o pedido na expedição com a quantidade de caixas
        await db.query(`
            INSERT INTO pedidos (cliente, tipo_onda, medida, qtd_programada, status) 
            VALUES ($1, $2, $3, $4, 'PENDENTE')
        `, [cliente, tipo, medidaCaixa, quantidadeCaixas]);

        await db.query('COMMIT');
        res.json({ success: true, message: "Estoque atualizado com sucesso!" });

    } catch (err) {
        await db.query('ROLLBACK');
        console.error("ERRO NO BACKEND:", err.message);
        res.status(500).json({ message: "Erro ao processar: " + err.message });
    }
});

app.post('/conferir-pedido', async (req, res) => {
    const { id, qtdReal } = req.body;

    try {
        await db.query('BEGIN');

        // 1. Busca os dados do pedido que o Resposavel da expedicao está conferindo
        const dadosPedido = await db.query('SELECT * FROM pedidos WHERE id = $1', [id]);
        const p = dadosPedido.rows[0];

        // 2. Marca o pedido como concluído
        await db.query('UPDATE pedidos SET status = $1, qtd_conferida = $2 WHERE id = $3', ['CONCLUÍDO', qtdReal, id]);

        // 3. Adiciona as caixas no estoque final (Página de Caixas)
        // Se a medida já existir, ele soma. Se não, cria uma nova.
        await db.query(`
            INSERT INTO caixas (cliente, medidas, estoque) 
            VALUES ($1, $2, $3)
            ON CONFLICT (medidas) 
            DO UPDATE SET estoque = caixas.estoque + $3
        `, [p.cliente, p.medida, qtdReal]);

        await db.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await db.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    }
});

app.get('/verificar-estoque', async (req, res) => {
    // Pegamos os dados e já tratamos para bater com o banco padronizado
    const onda = req.query.tipo ? req.query.tipo.toUpperCase().trim() : '';
    const { largura, comprimento } = req.query;

    try {
        // Mudamos 'tipo' para 'onda' no comando SQL abaixo
        const sql = `
            SELECT quantidade 
            FROM chapas 
            WHERE onda = $1 
            AND largura::numeric = $2::numeric 
            AND comprimento::numeric = $3::numeric
        `;
        
        const resultado = await db.query(sql, [onda, largura, comprimento]);

        if (resultado.rows.length > 0) {
            // Note que usei resultado.rows[0].quantidade conforme sua imagem
            res.json({ estoque: resultado.rows[0].quantidade });
        } else {
            res.json({ estoque: 0 });
        }
    } catch (err) {
        console.error("Erro na consulta:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/tipos-chapa', async (req, res) => {
    try {
        // Busca os tipos únicos (ONDA B, ONDA BC, etc) em ordem alfabética
        const resultado = await db.query('SELECT DISTINCT onda FROM chapas ORDER BY onda ASC');
        res.json(resultado.rows);
    } catch (err) {
        res.status(500).json({ message: "Erro ao buscar tipos: " + err.message });
    }
});

app.get('/resumo-hoje', async (req, res) => {
    try {
        // Usando o nome correto: data_criacao
        const query = `
            SELECT 
                SUM(CASE WHEN status = 'CONCLUÍDO' THEN COALESCE(qtd_conferida, 0) ELSE 0 END) as total_caixas,
                COUNT(*) FILTER (WHERE status = 'PENDENTE') as fila_pedidos
            FROM pedidos 
            WHERE data_criacao::date = CURRENT_DATE
        `;
        
        const resultado = await db.query(query);
        
        // Convertendo para número para garantir que o front-end entenda
        res.json({
            total_caixas: parseInt(resultado.rows[0].total_caixas) || 0,
            fila_pedidos: parseInt(resultado.rows[0].fila_pedidos) || 0
        });
    } catch (err) {
        console.error("Erro no resumo:", err.message);
        res.status(500).json({ message: "Erro ao carregar resumo: " + err.message });
    }
});

// Rota para o Log Rápido da tela de produção
app.get('/historico-rapido', async (req, res) => {
    try {
        const query = `
            SELECT cliente, qtd_programada 
            FROM pedidos 
            WHERE data_criacao::date = CURRENT_DATE 
            ORDER BY data_criacao DESC 
        `;
        const resultado = await db.query(query);
        res.json(resultado.rows);
    } catch (err) {
        console.error("Erro na rota historico-rapido:", err.message);
        res.status(500).json({ error: err.message });
    }
});

app.listen(3000, () => {
    console.log("✅ Servidor J&E rodando na porta 3000");
});