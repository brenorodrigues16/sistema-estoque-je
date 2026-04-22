const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();

// --- CONFIGURAÇÕES DO SERVIDOR ---
app.use(cors());
app.use(bodyParser.json());

// Servir arquivos estáticos da pasta 'public'
app.use(express.static(path.join(__dirname, 'public')));

// --- CONEXÃO COM O BANCO DE DADOS ---
const db = new sqlite3.Database('./estoque.db', (err) => {
    if (err) console.error('Erro ao abrir banco:', err.message);
    else console.log('Conectado ao Banco de Dados SQLite.');
});

// Criar as tabelas iniciais
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS chapas (id INTEGER PRIMARY KEY, tipo TEXT, qtd INTEGER, comp INTEGER, larg INTEGER)`);
    db.run(`CREATE TABLE IF NOT EXISTS caixas (id INTEGER PRIMARY KEY, codigo TEXT, medida TEXT, qtd INTEGER)`);
    db.run(`CREATE TABLE IF NOT EXISTS movimentacoes (id INTEGER PRIMARY KEY, data TEXT, produto TEXT, tipo TEXT, qtd INTEGER)`);

    db.get("SELECT count(*) as count FROM chapas", (err, row) => {
        if (row && row.count === 0) {
            db.run(`INSERT INTO chapas (tipo, qtd, comp, larg) VALUES ('onda-b', 800, 2750, 1850), ('onda-bc', 150, 3000, 2000)`);
        }
    });
});

// --- ROTAS DO SISTEMA ---

// Rota principal: Abre o index.html automaticamente
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Buscar todos os dados
app.get('/dados', (req, res) => {
    db.all("SELECT * FROM chapas", [], (err, chapas) => {
        db.all("SELECT * FROM caixas", [], (err, caixas) => {
            db.all("SELECT * FROM movimentacoes ORDER BY id DESC", [], (err, movimentacoes) => {
                res.json({ chapas, caixas, movimentacoes });
            });
        });
    });
});

// Produção
app.post('/produzir', (req, res) => {
    const { tipoChapa, quantidade, medidaCaixa } = req.body;
    const qtd = parseInt(quantidade);

    db.get("SELECT * FROM chapas WHERE tipo = ?", [tipoChapa], (err, chapa) => {
        if (!chapa || chapa.qtd < qtd) {
            return res.status(400).json({ message: "Estoque de chapas insuficiente!" });
        }

        db.run("UPDATE chapas SET qtd = qtd - ? WHERE tipo = ?", [qtd, tipoChapa]);

        db.get("SELECT * FROM caixas WHERE medida = ?", [medidaCaixa], (err, caixa) => {
            if (caixa) {
                db.run("UPDATE caixas SET qtd = qtd + ? WHERE medida = ?", [qtd, medidaCaixa]);
            } else {
                db.run("INSERT INTO caixas (codigo, medida, qtd) VALUES (?, ?, ?)", ['CX-' + medidaCaixa, medidaCaixa, qtd]);
            }
        });

        const dataAtual = "22/04/2026"; 
        db.run("INSERT INTO movimentacoes (data, produto, tipo, qtd) VALUES (?, ?, ?, ?)", 
            [dataAtual, `Caixa ${medidaCaixa}`, 'Produção', qtd]);

        res.json({ message: "Produção registrada com sucesso!" });
    });
});

// Adicionar Nova Chapa
app.post('/add-chapa', (req, res) => {
    const { tipo, qtd, comp, larg } = req.body;
    db.run(`INSERT INTO chapas (tipo, qtd, comp, larg) VALUES (?, ?, ?, ?)`, 
        [tipo, qtd, comp, larg], (err) => {
            if (err) return res.status(500).json({ message: "Erro ao salvar chapa." });
            db.run("INSERT INTO movimentacoes (data, produto, tipo, qtd) VALUES (?, ?, ?, ?)", 
                ["22/04/2026", `Chapa ${tipo}`, 'Entrada (Compra)', qtd]);
            res.json({ message: "Chapa cadastrada com sucesso!" });
        });
});

// Adicionar Nova Caixa
app.post('/add-caixa', (req, res) => {
    const { codigo, medida, qtd } = req.body;
    db.run(`INSERT INTO caixas (codigo, medida, qtd) VALUES (?, ?, ?)`, 
        [codigo, medida, qtd], (err) => {
            if (err) return res.status(500).json({ message: "Erro ao salvar caixa." });
            res.json({ message: "Caixa cadastrada com sucesso!" });
        });
});

// Buscar Caixas (Filtro)
app.get('/buscar-caixas', (req, res) => {
    const termo = req.query.termo;
    const query = `SELECT * FROM caixas WHERE codigo LIKE ? OR medida LIKE ?`;
    db.all(query, [`%${termo}%`, `%${termo}%`], (err, rows) => {
        if (err) return res.status(500).send(err);
        res.json(rows);
    });
});

// Excluir Chapa
app.delete('/excluir-chapa/:id', (req, res) => {
    const id = req.params.id;
    db.run(`DELETE FROM chapas WHERE id = ?`, [id], (err) => {
        if (err) return res.status(500).json({ message: "Erro ao excluir." });
        res.json({ message: "Chapa excluída com sucesso!" });
    });
});

// Excluir Caixa
app.delete('/excluir-caixa/:id', (req, res) => {
    const id = req.params.id;
    db.run(`DELETE FROM caixas WHERE id = ?`, [id], (err) => {
        if (err) return res.status(500).json({ message: "Erro ao excluir." });
        res.json({ message: "Caixa excluída com sucesso!" });
    });
});

// Iniciar Servidor
app.listen(3000, () => {
    console.log("-----------------------------------------");
    console.log("SERVIDOR ATIVO EM: http://localhost:3000");
    console.log("BANCO DE DADOS: estoque.db criado/conectado");
    console.log("-----------------------------------------");
});