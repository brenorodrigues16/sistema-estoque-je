const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const app = express();

app.use(cors());
app.use(express.json());

// Conexão com Banco de Dados (Configurado para o Render/Nuvem)
const db = mysql.createPool(process.env.DATABASE_URL || {
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'sistema_estoque'
});

// ROTA: Lançar Produção (Baixa chapa e aumenta caixa)
app.post('/produzir', (req, res) => {
    const { tipoChapa, medidaCaixa, quantidade } = req.body;
    
    // 1. Diminui as chapas do estoque
    const sqlChapa = "UPDATE chapas SET qtd = qtd - ? WHERE tipo = ?";
    db.query(sqlChapa, [quantidade, tipoChapa], (err) => {
        if (err) return res.status(500).json({ message: "Erro ao baixar chapa" });

        // 2. Aumenta ou cria a caixa no estoque
        const sqlCaixa = "INSERT INTO caixas (codigo, medidas, quantidade) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE quantidade = quantidade + ?";
        db.query(sqlCaixa, [medidaCaixa, medidaCaixa, quantidade, quantidade], (err) => {
            if (err) return res.status(500).json({ message: "Erro ao atualizar caixas" });
            res.json({ message: "Produção finalizada com sucesso!", detalhes: `${quantidade} caixas adicionadas.` });
        });
    });
});

// ROTAS DE BUSCA
app.get('/dados', (req, res) => {
    db.query('SELECT * FROM chapas', (err, chapas) => {
        db.query('SELECT * FROM caixas', (err, caixas) => {
            res.json({ chapas, caixas });
        });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor J&E rodando na porta ${PORT}`));

const path = require('path');

// Esta linha diz ao servidor onde estão seus arquivos HTML (assumindo que estão na pasta raiz ou 'public')
app.use(express.static(__dirname)); 

// Esta linha faz o link abrir o index.html automaticamente
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});