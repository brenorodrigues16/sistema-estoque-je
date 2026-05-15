require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/teste-db', async (req, res)=>{
    try{
        const result = await pool.query('SELECT NOW()');
        res.json({ status: "Conectado!", data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: "Erro ao conectar no banco", details: err.message });
    }
});

app.get('/tipos-onda', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM chapas');
        const formatado = result.rows.map(row => {
            return {
                onda: row.onda || row.nome || row.tipo || Object.values(row)[1] 
            };
        });

        console.log("Ondas encontradas e formatadas:", formatado);
        res.json(formatado);
    } catch (err) {
        console.error("ERRO NA TABELA CHAPAS:", err.message);
        res.status(500).json([]);
    }
});

// --- ROTAS DO DASHBOARD ---
// Rota para o Dashboard (Soma o total e lista as chapas)
app.get('/dados', async (req, res) => {
    try {
        // Busca a soma total geral
        const totalGeral = await pool.query('SELECT SUM(quantidade) as total FROM chapas');
        
        // Busca a soma agrupada por ONDA (agora ONDA BC de tamanhos diferentes vira uma linha só)
        const agrupado = await pool.query(`
            SELECT onda, SUM(quantidade) as quantidade 
            FROM chapas 
            GROUP BY onda 
            ORDER BY onda ASC
        `);

        res.json({
            estoqueTotal: parseInt(totalGeral.rows[0].total) || 0,
            chapas: agrupado.rows
        });
    } catch (err) {
        console.error("Erro na rota /dados:", err.message);
        res.status(500).json({ error: "Erro ao processar dados" });
    }
});

app.get('/resumo-hoje', async (req, res) => {
    try {
        // Usamos ::date para comparar apenas Dia/Mês/Ano
        const fila = await pool.query(`
            SELECT COUNT(*) as total 
            FROM pedidos 
            WHERE status = 'PENDENTE' 
            AND created_at::date = CURRENT_DATE`);
        
        const caixas = await pool.query(`
            SELECT COALESCE(SUM(qtd_programada), 0) as total 
            FROM pedidos 
            WHERE (status = 'CONCLUÍDO' OR status = 'CONCLUSÃO')
            AND created_at::date = CURRENT_DATE`);

        console.log("Fila hoje:", fila.rows[0].total); // Isso aparecerá no terminal do VS Code

        res.json({
            total_caixas: parseInt(caixas.rows[0].total) || 0,
            fila_pedidos: parseInt(fila.rows[0].total) || 0
        });
    } catch (err) {
        console.error("Erro na rota resumo:", err.message);
        res.status(500).json({ total_caixas: 0, fila_pedidos: 0 });
    }
});

// --- ROTAS DE CHAPAS ---
app.get('/api/chapas', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM chapas ORDER BY onda ASC');
        res.json(result.rows);
    } catch (err) {
        console.error("Erro ao buscar chapas:", err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/chapas', async (req, res) => {
    const { onda, fornecedor, comprimento, largura, quantidade } = req.body;
    try {
        await pool.query(
            'INSERT INTO chapas (onda, fornecedor, comprimento, largura, quantidade) VALUES ($1, $2, $3, $4, $5)',
            [onda, fornecedor, comprimento, largura, quantidade]
        );
        res.json({ success: true });
    } catch (err) {
        console.error("Erro ao inserir:", err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- PRODUÇÃO E EXPEDIÇÃO ---
app.post('/produzir', async (req, res) => {
    // Pegando os nomes exatamente como o seu HTML envia no "payload"
    const { cliente, referencia, tipo_onda, largura_chapa, comprimento_chapa, qtd_chapas_necessarias, qtd_programada, medida } = req.body;
    
    try {
        await pool.query('BEGIN'); // Use pool, não db

        // 1. Atualiza o estoque de chapas
        const queryEstoque = `
            UPDATE chapas 
            SET quantidade = quantidade - $1 
            WHERE TRIM(UPPER(onda)) = TRIM(UPPER($2)) 
              AND largura = $3 
              AND comprimento = $4`;
        
        const updateEstoque = await pool.query(queryEstoque, [qtd_chapas_necessarias, tipo_onda, largura_chapa, comprimento_chapa]);

        if (updateEstoque.rowCount === 0) {
            await pool.query('ROLLBACK');
            return res.status(400).json({ success: false, message: "Chapa não encontrada ou estoque insuficiente." });
        }

        // 2. Insere o pedido
        await pool.query(`
            INSERT INTO pedidos (cliente, referencia, tipo_onda, medida, qtd_programada, status) 
            VALUES ($1, $2, $3, $4, $5, 'PENDENTE')`, 
            [cliente, referencia, tipo_onda, medida, qtd_programada]);

        await pool.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        if (pool) await pool.query('ROLLBACK');
        console.error("Erro na produção:", err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});


app.get('/pedidos-recentes', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT cliente, qtd_programada, referencia, status 
            FROM pedidos 
            WHERE created_at::date = CURRENT_DATE
            ORDER BY id DESC`);
        
        res.json(result.rows);
    } catch (err) {
        console.error("Erro na rota pedidos-recentes:", err.message);
        res.status(500).json([]);
    }
});

app.post('/conferir-pedido', async (req, res) => {
    const { id, quantidade_conferida, responsavel } = req.body;
    try {
        await db.query('BEGIN');
        const resPedido = await db.query(
            `UPDATE public.pedidos SET status = 'CONCLUÍDO', quantidade_conferida = $1, responsavel = $2 WHERE id = $3 RETURNING *`,
            [quantidade_conferida, responsavel, id]
        );
        const p = resPedido.rows[0];
        await db.query(`
            INSERT INTO public.caixas (codigo, medidas, quantidade, cliente) 
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (codigo) 
            DO UPDATE SET quantidade = caixas.quantidade + $3
        `, [p.referencia || 'SEM_COD', p.medida || 'N/A', quantidade_conferida, p.cliente]);
        await db.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await db.query('ROLLBACK');
        res.status(500).json({ success: false, message: err.message });
    }
});



app.post('/api/chapas', async (req, res) => {
    const { nome, estoque, largura, comprimento } = req.body;
    try {
        await pool.query(
            'INSERT INTO chapas (nome, estoque, largura, comprimento) VALUES ($1, $2, $3, $4)',
            [nome, estoque, largura, comprimento]
        );
        res.json({ success: true, message: "Chapa adicionada!" });
    } catch (err) {
        console.error("Erro ao adicionar chapa:", err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Rota para a tabela de chapas
// 1. Rota para Listar Chapas
app.get('/api/chapas', async (req, res) => {
    try {
        // Buscamos tudo da tabela chapas
        const result = await pool.query('SELECT * FROM chapas ORDER BY onda ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Rota para Adicionar Nova Chapa (Botão .btn-add)
app.post('/api/chapas', async (req, res) => {
    const { onda, fornecedor, comprimento, largura, quantidade } = req.body;
    try {
        await pool.query(
            'INSERT INTO chapas (onda, fornecedor, comprimento, largura, quantidade) VALUES ($1, $2, $3, $4, $5)',
            [onda, fornecedor, comprimento, largura, quantidade]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 3. Rota para Editar/Ajustar Estoque (Função abrirAjuste)
app.post('/ajustar-estoque', async (req, res) => {
    const { id, novaQuantidade, novoComprimento, novaLargura, novoFornecedor } = req.body;
    try {
        await pool.query(
            'UPDATE chapas SET quantidade=$1, comprimento=$2, largura=$3, fornecedor=$4 WHERE id=$5',
            [novaQuantidade, novoComprimento, novaLargura, novoFornecedor, id]
        );
        res.json({ success: true });
    } catch (err) {
        console.error("Erro ao editar:", err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 4. Rota extra para Fornecedores (que o seu script pede)
app.get('/fornecedores', async (req, res) => {
    try {
        // Se você não tiver uma tabela de fornecedores, vamos mandar uma lista padrão
        // para o script não travar. Ou troque pela sua query de fornecedores.
        const result = await pool.query('SELECT nome FROM fornecedores ORDER BY nome ASC');
        res.json(result.rows);
    } catch (err) {
        // Caso não tenha a tabela ainda, manda uma lista fixa para testar:
        res.json([{ nome: 'Fornecedor A' }, { nome: 'Fornecedor B' }]);
    }
});

app.put('/api/chapas/:id', async (req, res) => {
    const { id } = req.params;
    const { nome, estoque, largura, comprimento } = req.body;
    try {
        await pool.query(
            'UPDATE chapas SET nome=$1, estoque=$2, largura=$3, comprimento=$4 WHERE id=$5',
            [nome, estoque, largura, comprimento, id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/caixas', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM caixas ORDER BY id DESC');
        res.json(result.rows);
 
   } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/caixas', async (req, res) => {
    try {
        const { cliente, codigo, quantidade, data_fabricacao, responsavel } = req.body;
        await pool.query(
            "INSERT INTO caixas (cliente, codigo, quantidade, data_fabricacao, responsavel) VALUES ($1, $2, $3, $4, $5)",
            [cliente, codigo, quantidade, data_fabricacao, responsavel]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/caixas/ajustar-estoque', async (req, res) => {
    const { id, mudanca } = req.body;
    try {
        await pool.query('UPDATE caixas SET quantidade = quantidade + $1 WHERE id = $2', [mudanca, id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/caixas/editar', async (req, res) => {
    const { id, cliente, codigo, quantidade, data_fabricacao, responsavel } = req.body;

    try {
        const query = `
            UPDATE caixas 
            SET cliente = $1, 
                codigo = $2, 
                quantidade = $3, 
                data_fabricacao = $4, 
                responsavel = $5 
            WHERE id = $6`;
        
        const values = [cliente, codigo, quantidade, data_fabricacao, responsavel, id];
        
        await pool.query(query, values);
        res.json({ success: true });
    } catch (err) {
        console.error("Erro no servidor:", err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});


// Rota para Registrar Produção (Subtrai chapa e adiciona caixa)
app.post('/api/producao', async (req, res) => {
    const { cliente, referencia, tipoOnda, quantidade } = req.body;

    try {
        await pool.query('BEGIN');
        const queryPedido = `
            INSERT INTO pedidos (cliente, referencia, tipo_onda, qtd_programado, status) 
            VALUES ($1, $2, $3, $4, 'CONCLUSÃO')`;
        await pool.query(queryPedido, [cliente, referencia, tipoOnda, quantidade]);

        await pool.query('UPDATE chapas SET quantidade = quantidade - $1 WHERE nome = $2', [quantidade, tipoOnda]);

        await pool.query('COMMIT');
        
        res.json({ success: true, message: "Produção registrada e estoque atualizado!" });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error(err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});


app.listen(3000, () => {
    console.log("✅ Servidor J&E rodando na porta 3000 com prefixo public.");
});