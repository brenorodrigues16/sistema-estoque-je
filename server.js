const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();

// --- CONFIGURAÇÕES DO SERVIDOR ---
app.use(cors());
app.use(bodyParser.json());

// Força o Node a enxergar a pasta 'public' de forma absoluta
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

// --- CONEXÃO COM O BANCO DE DADOS ---
const db = new sqlite3.Database('./estoque.db', (err) => {
    if (err) console.error('Erro ao abrir banco:', err.message);
    else console.log('Conectado ao Banco de Dados SQLite.');
});

// Criar as tabelas iniciais se não existirem
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS chapas (id INTEGER PRIMARY KEY, tipo TEXT, qtd INTEGER, comp INTEGER, larg INTEGER)`);
    db.run(`CREATE TABLE IF NOT EXISTS caixas (id INTEGER PRIMARY KEY, codigo TEXT, medida TEXT, qtd INTEGER)`);
    db.run(`CREATE TABLE IF NOT EXISTS movimentacoes (id INTEGER PRIMARY KEY, data TEXT, produto TEXT, tipo TEXT, qtd INTEGER)`);

    // Inserir dados iniciais apenas se estiver vazio
    db.get("SELECT count(*) as count FROM chapas", (err, row) => {
        if (row && row.count === 0) {
            db.run(`INSERT INTO chapas (tipo, qtd, comp, larg) VALUES ('onda-b', 800, 2750, 1850), ('onda-bc', 150, 3000, 2000)`);
        }
    });
});

// --- ROTA PRINCIPAL (ABRIR O SITE) ---
app.get('/', (req, res) => {
    // Tenta enviar o arquivo index.html de dentro da pasta public
    res.sendFile(path.join(publicPath, 'index.html'), (err) => {
        if (err) {
            res.status(404).send("<h1>Erro: Arquivo index.html não encontrado!</h1><p>Verifique se ele está dentro da pasta <b>public</b>.</p>");
        }
    });
});

// --- ROTAS DE DADOS ---

// Buscar todos os dados para o Dashboard e Tabelas
app.get('/dados', (req, res) => {
    db.all("SELECT * FROM chapas", [], (err, chapas) => {
        db.all("SELECT * FROM caixas", [], (err, caixas) => {
            db.all("SELECT * FROM movimentacoes ORDER BY id DESC", [], (err, movimentacoes) => {
                res.json({ chapas, caixas, movimentacoes });
            });
        });
    });
});

// Rota de Produção
app.post('/produzir', (req, res) => {
    const { tipoChapa, quantidade, medidaCaixa } = req.body;
    const qtd = parseInt(quantidade);

    db.get("SELECT * FROM chapas WHERE tipo = ?", [tipoChapa], (err, chapa) => {
        if (!chapa || chapa.qtd < qtd) {
            return res.status(400).json({ message: "Estoque insuficiente de chapas!" });
        }

        db.get("SELECT * FROM caixas WHERE medida = ?", [medidaCaixa], (err, caixaExistente) => {
            let statusProducao = caixaExistente ? "atualizada" : "criada";
            
            db.serialize(() => {
                // Diminui a chapa
                db.run("UPDATE chapas SET qtd = qtd - ? WHERE tipo = ?", [qtd, tipoChapa]);
                
                // Se já existe, soma. Se não, cria.
                if (caixaExistente) {
                    db.run("UPDATE caixas SET qtd = qtd + ? WHERE medida = ?", [qtd, medidaCaixa]);
                } else {
                    db.run("INSERT INTO caixas (codigo, medida, qtd) VALUES (?, ?, ?)", ['CX-' + medidaCaixa, medidaCaixa, qtd]);
                }

                db.run("INSERT INTO movimentacoes (data, produto, tipo, qtd) VALUES (?, ?, ?, ?)", 
                    ["22/04/2026", `Caixa ${medidaCaixa}`, 'Produção', qtd]);
            });

            res.json({ 
                message: "Produção Concluída!", 
                detalhes: `A caixa ${medidaCaixa} foi ${statusProducao}. Novo saldo registrado.`,
                status: statusProducao 
            });
        });
    });
});

// Adicionar Nova Chapa
app.post('/add-chapa', (req, res) => {
    const { tipo, qtd, comp, larg } = req.body;
    db.run(`INSERT INTO chapas (tipo, qtd, comp, larg) VALUES (?, ?, ?, ?)`, [tipo, qtd, comp, larg], (err) => {
        if (err) return res.status(500).json({ message: "Erro ao salvar." });
        db.run("INSERT INTO movimentacoes (data, produto, tipo, qtd) VALUES (?, ?, ?, ?)", ["22/04/2026", `Chapa ${tipo}`, 'Entrada', qtd]);
        res.json({ message: "Chapa cadastrada!" });
    });
});

// Busca de Caixas
app.get('/buscar-caixas', (req, res) => {
    const termo = req.query.termo;
    db.all(`SELECT * FROM caixas WHERE codigo LIKE ? OR medida LIKE ?`, [`%${termo}%`, `%${termo}%`], (err, rows) => {
        if (err) return res.status(500).send(err);
        res.json(rows);
    });
});

// Excluir Chapa
app.delete('/excluir-chapa/:id', (req, res) => {
    db.run(`DELETE FROM chapas WHERE id = ?`, [req.params.id], (err) => {
        if (err) return res.status(500).json({ message: "Erro ao excluir." });
        res.json({ message: "Excluído com sucesso!" });
    });
});

// Excluir Caixa
app.delete('/excluir-caixa/:id', (req, res) => {
    db.run(`DELETE FROM caixas WHERE id = ?`, [req.params.id], (err) => {
        if (err) return res.status(500).json({ message: "Erro ao excluir." });
        res.json({ message: "Excluído com sucesso!" });
    });
});

// --- INICIALIZAÇÃO ---
const PORT = 3000;
app.listen(PORT, () => {
    console.log("-----------------------------------------");
    console.log(`SERVIDOR RODANDO: http://localhost:${PORT}`);
    console.log(`PASTA DE ARQUIVOS: ${publicPath}`);
    console.log("-----------------------------------------");
});