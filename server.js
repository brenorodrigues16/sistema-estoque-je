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

// Rota para listar todos os fornecedores (com o novo campo contato)
app.get('/fornecedores-completo', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM fornecedores ORDER BY nome ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Rota para adicionar um novo fornecedor
app.post('/add-fornecedor', async (req, res) => {
    const { nome, contato } = req.body;
    try {
        await db.query('INSERT INTO fornecedores (nome, contato) VALUES ($1, $2)', [nome, contato]);
        res.json({ message: "Fornecedor cadastrado com sucesso!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ROTAS DE FORNECEDORES (A que as páginas estão pedindo!) ---
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

app.listen(3000, () => {
    console.log("✅ Servidor J&E rodando na porta 3000");
});