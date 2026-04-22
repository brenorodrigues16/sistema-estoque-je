const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Conexão com o Banco de Dados (Cria o arquivo estoque.db automaticamente)
const db = new sqlite3.Database('./estoque.db', (err) => {
    if (err) console.error('Erro ao abrir banco:', err.message);
    else console.log('Conectado ao Banco de Dados SQLite.');
});

// Criar as tabelas iniciais se não existirem
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS chapas (id INTEGER PRIMARY KEY, tipo TEXT, qtd INTEGER, comp INTEGER, larg INTEGER)`);
    db.run(`CREATE TABLE IF NOT EXISTS caixas (id INTEGER PRIMARY KEY, codigo TEXT, medida TEXT, qtd INTEGER)`);
    db.run(`CREATE TABLE IF NOT EXISTS movimentacoes (id INTEGER PRIMARY KEY, data TEXT, produto TEXT, tipo TEXT, qtd INTEGER)`);

    // Inserir dados de exemplo apenas se a tabela estiver vazia
    db.get("SELECT count(*) as count FROM chapas", (err, row) => {
        if (row.count === 0) {
            db.run(`INSERT INTO chapas (tipo, qtd, comp, larg) VALUES ('onda-b', 800, 2750, 1850), ('onda-bc', 150, 3000, 2000)`);
        }
    });
});

// ROTA PARA BUSCAR TODOS OS DADOS
app.get('/dados', (req, res) => {
    db.all("SELECT * FROM chapas", [], (err, chapas) => {
        db.all("SELECT * FROM caixas", [], (err, caixas) => {
            db.all("SELECT * FROM movimentacoes ORDER BY id DESC", [], (err, movimentacoes) => {
                res.json({ chapas, caixas, movimentacoes });
            });
        });
    });
});

// ROTA DE PRODUÇÃO (Lógica Principal)
app.post('/produzir', (req, res) => {
    const { tipoChapa, quantidade, medidaCaixa } = req.body;
    const qtd = parseInt(quantidade);

    // 1. Verificar estoque de chapa
    db.get("SELECT * FROM chapas WHERE tipo = ?", [tipoChapa], (err, chapa) => {
        if (!chapa || chapa.qtd < qtd) {
            return res.status(400).json({ message: "Estoque de chapas insuficiente!" });
        }

        // 2. Diminuir chapas
        db.run("UPDATE chapas SET qtd = qtd - ? WHERE tipo = ?", [qtd, tipoChapa]);

        // 3. Aumentar ou criar caixa
        db.get("SELECT * FROM caixas WHERE medida = ?", [medidaCaixa], (err, caixa) => {
            if (caixa) {
                db.run("UPDATE caixas SET qtd = qtd + ? WHERE medida = ?", [qtd, medidaCaixa]);
            } else {
                db.run("INSERT INTO caixas (codigo, medida, qtd) VALUES (?, ?, ?)", ['CX-' + medidaCaixa, medidaCaixa, qtd]);
            }
        });

        // 4. Registrar Movimentação com Data Atualizada (2026)
        const dataAtual = "22/04/2026"; 
        db.run("INSERT INTO movimentacoes (data, produto, tipo, qtd) VALUES (?, ?, ?, ?)", 
            [dataAtual, `Caixa ${medidaCaixa}`, 'Produção', qtd]);

        res.json({ message: "Produção registrada com sucesso no Banco de Dados!" });
    });
});

// ROTA PARA ADICIONAR NOVA CHAPA (Entrada de Fornecedor)
app.post('/add-chapa', (req, res) => {
    const { tipo, qtd, comp, larg } = req.body;
    db.run(`INSERT INTO chapas (tipo, qtd, comp, larg) VALUES (?, ?, ?, ?)`, 
        [tipo, qtd, comp, larg], (err) => {
            if (err) return res.status(500).json({ message: "Erro ao salvar chapa." });
            
            // Registra a entrada no histórico
            db.run("INSERT INTO movimentacoes (data, produto, tipo, qtd) VALUES (?, ?, ?, ?)", 
                ["22/04/2026", `Chapa ${tipo}`, 'Entrada (Compra)', qtd]);
                
            res.json({ message: "Chapa cadastrada com sucesso!" });
        });
});

// ROTA PARA ADICIONAR NOVA CAIXA (Ajuste de Inventário)
app.post('/add-caixa', (req, res) => {
    const { codigo, medida, qtd } = req.body;
    db.run(`INSERT INTO caixas (codigo, medida, qtd) VALUES (?, ?, ?)`, 
        [codigo, medida, qtd], (err) => {
            if (err) return res.status(500).json({ message: "Erro ao salvar caixa." });
            res.json({ message: "Caixa cadastrada com sucesso!" });
        });
});

app.listen(3000, () => {
    console.log("-----------------------------------------");
    console.log("SERVIDOR ATIVO EM: http://localhost:3000");
    console.log("BANCO DE DADOS: estoque.db criado/conectado");
    console.log("-----------------------------------------");
});