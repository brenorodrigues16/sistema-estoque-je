require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

// Configuração do Banco de Dados
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'docs')));

// --- SISTEMA DE LOGS ---
function logger(tipo, mensagem) {
    const dataHora = new Date().toLocaleString('pt-BR');
    const logFormatado = `[${dataHora}] [${String(tipo).toUpperCase()}] ${mensagem}\n`;
    console.log(logFormatado.trim());
    const caminhoLog = path.join(__dirname, 'sistema.log');
    fs.appendFile(caminhoLog, logFormatado, (err) => {
        if (err) console.error("falha ao salvar log:", err);
    });
}

app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});

// --- ROTA PRINCIPAL ---
app.get('/api', (req, res) => {
    res.sendFile(path.join(__dirname, 'docs', 'index.html'));
});

// --- ROTA DE TESTE ---
app.get('/api/teste-db', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW()');
        res.json({ status: "Conectado!", data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: "Erro ao conectar", details: err.message });
    }
});

// --- ROTAS DE CHAPAS (MATÉRIA-PRIMA) ---

// Busca todas as chapas
app.get('/api/chapas', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM chapas ORDER BY onda ASC');
        res.json(result.rows);
    } catch (err) {
        logger("error", `Erro ao buscar chapas: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// Cadastra nova chapa (Versão completa)
app.post('/api/chapas', async (req, res) => {
    const { onda, fornecedor, comprimento, largura, quantidade } = req.body;
    try {
        await pool.query(
            'INSERT INTO chapas (onda, fornecedor, comprimento, largura, quantidade) VALUES ($1, $2, $3, $4, $5)',
            [onda, fornecedor, comprimento, largura, quantidade]
        );
        res.json({ success: true, message: "Chapa registrada com sucesso." });
    } catch (err) {
        logger("error", `Erro ao inserir chapa: ${err.message}`);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Ajustar dados da chapa via POST
app.post('/api/chapas/ajustar-estoque', async (req, res) => {
    const { id, onda, novaQuantidade, novoComprimento, novaLargura, novoFornecedor } = req.body;
    try {
        const query = `UPDATE chapas SET onda = $1, quantidade = $2, comprimento = $3, largura = $4, fornecedor = $5 WHERE id = $6`;
        await pool.query(query, [onda, novaQuantidade, novoComprimento, novaLargura, novoFornecedor, id]);
        res.status(200).json({ message: "Atualizado!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Editar chapa via PUT (Algumas páginas podem usar este método)
app.put('/api/chapas/:id', async (req, res) => {
    const { id } = req.params;
    const { nome, estoque, largura, comprimento } = req.body;
    try {
        await pool.query('UPDATE chapas SET nome=$1, estoque=$2, largura=$3, comprimento=$4 WHERE id=$5', [nome, estoque, largura, comprimento, id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

// Busca tipos de onda (com hífen)
app.get('/api/tipos-onda', async (req, res) => {
    try {
        const result = await pool.query('SELECT DISTINCT onda FROM chapas');
        res.json(result.rows.map(row => ({ onda: row.onda })));
    } catch (err) { res.status(500).json([]); }
});

// Busca tipos de onda (com underline)
app.get('/api/tipos_onda', async (req, res) => {
    try {
        const result = await pool.query('SELECT DISTINCT onda FROM chapas');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Erro no servidor' }); }
});

// Verifica estoque de uma chapa específica
app.get('/api/verificar-estoque', async (req, res) => {
    const { tipo, largura, comprimento } = req.query;
    try {
        const result = await pool.query('SELECT quantidade FROM chapas WHERE TRIM(UPPER(onda)) = TRIM(UPPER($1)) AND largura = $2 AND comprimento = $3 LIMIT 1', [tipo, largura, comprimento]);
        res.json({ estoque: result.rows.length > 0 ? result.rows[0].quantidade : 0 });
    } catch (err) { res.status(500).json({ estoque: 0 }); }
});

// --- ROTAS DE PRODUÇÃO E PEDIDOS ---

// - - INICIA A PRODUCAO E (DIMINUI ESTOQUE DE CHAPAS {USADA}) - - //
app.post('/api/produzir', async (req, res) => {
    const { cliente, referencia, tipo_onda, largura_chapa, comprimento_chapa, qtd_chapas_necessarias, qtd_programada, medida } = req.body;
    try {
        await pool.query('BEGIN');
        const updateEstoque = await pool.query(`UPDATE chapas SET quantidade = quantidade - $1 WHERE TRIM(UPPER(onda)) = TRIM(UPPER($2)) AND largura = $3 AND comprimento = $4`, [qtd_chapas_necessarias, tipo_onda, largura_chapa, comprimento_chapa]);
        if (updateEstoque.rowCount === 0) throw new Error("Estoque insuficiente");
        await pool.query(`INSERT INTO pedidos (cliente, referencia, tipo_onda, medida, qtd_programada, status) VALUES ($1, $2, $3, $4, $5, 'PENDENTE')`, [cliente, referencia, tipo_onda, medida, qtd_programada]);
        await pool.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await pool.query('ROLLBACK');
        res.status(400).json({ success: false, message: err.message });
    }
});

// Rota alternativa de produção
app.post('/api/producao', async (req, res) => {
    const { cliente, referencia, tipoOnda, quantidade } = req.body;
    try {
        await pool.query('BEGIN');
        await pool.query(`INSERT INTO pedidos (cliente, referencia, tipo_onda, qtd_programado, status) VALUES ($1, $2, $3, $4, 'CONCLUSÃO')`, [cliente, referencia, tipoOnda, quantidade]);
        await pool.query('UPDATE chapas SET quantidade = quantidade - $1 WHERE nome = $2', [quantidade, tipoOnda]);
        await pool.query('COMMIT');
        res.json({ success: true });
    } catch (err) { await pool.query('ROLLBACK'); res.status(500).json({ success: false }); }
});

// --- ROTAS DE EXPEDIÇÃO E CONFERÊNCIA ---

// - - BUSCA PEDIDOS PENDENTES OU CONCLUIDOS = CARDS? - - //
app.get('/api/pedidos-recentes', async (req, res) => {
    try {
        const query = `SELECT * FROM pedidos WHERE status = 'PENDENTE' OR (status = 'CONCLUÍDO' AND created_at::date = CURRENT_DATE) ORDER BY id DESC`;
        const resultado = await pool.query(query);
        res.json(resultado.rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// - - CONFERENCIA E ENVIA PARA + CAIXAS - - // 
app.post('/api/conferir-pedido', async (req, res) => {
    const { id, qtd_conferida, responsavel } = req.body;
    try {
        await pool.query('BEGIN');
        const resPedido = await pool.query(`UPDATE pedidos SET status = 'CONCLUÍDO', qtd_conferida = $1, responsavel = $2 WHERE id = $3 RETURNING *`, [qtd_conferida, responsavel, id]);
        const pedido = resPedido.rows[0];
        await pool.query(`INSERT INTO caixas (cliente, codigo, quantidade, data_fabricacao, responsavel) VALUES ($1, $2, $3, NOW(), $4) ON CONFLICT (cliente, codigo) DO UPDATE SET quantidade = caixas.quantidade + EXCLUDED.quantidade`, [pedido.cliente, pedido.referencia || 'S/ REF', qtd_conferida, responsavel]);
        await pool.query(`INSERT INTO movimentacoes (tipo, descricao, quantidade, responsavel, data) VALUES ($1, $2, $3, $4, NOW())`, ['ENTRADA ESTOQUE', `Produção: ${pedido.referencia}`, qtd_conferida, responsavel]);
        await pool.query('COMMIT');
        res.json({ success: true });
    } catch (error) { await pool.query('ROLLBACK'); res.status(500).json({ success: false }); }
});

// --- ROTAS DE CAIXAS (PRODUTO ACABADO) ---

app.get('/api/caixas', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM caixas');
        res.json(result.rows);
    } catch (err) {
         res.status(500).json({ error: err.message });
 }
});
// - - REGISTRAR CAIXA - - //
app.post('/api/registrar-caixa', async (req, res) => {
    const { cliente, codigo, quantidade, data_fabricacao, responsavel } = req.body;
    try {
        await pool.query("INSERT INTO caixas (cliente, codigo, quantidade, data_fabricacao, responsavel) VALUES ($1, $2, $3, $4, $5)", [cliente, codigo, quantidade, data_fabricacao, responsavel]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});
// - - AJUSTAR ESTOQUE DE CAIXAS - - // 
app.post('/api/ajustar-estoque', async (req, res) => {
    const { id, mudanca } = req.body;
    try {
        await pool.query('UPDATE caixas SET quantidade = quantidade + $1 WHERE id = $2', [mudanca, id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/caixas/editar', async (req, res) => {
    const { id, cliente, codigo, quantidade, data_fabricacao, responsavel } = req.body;
    try {
        await pool.query(`UPDATE caixas SET cliente = $1, codigo = $2, quantidade = $3, data_fabricacao = $4, responsavel = $5 WHERE id = $6`, [cliente, codigo, quantidade, data_fabricacao, responsavel, id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.delete('/api/caixas/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM caixas WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

// --- ROTAS DE DASHBOARD E RELATÓRIOS ---

app.get('/api/dados', async (req, res) => {
    try {
        const total = await pool.query('SELECT SUM(quantidade) as total FROM chapas');
        const agrupado = await pool.query(`SELECT onda, SUM(quantidade) as quantidade FROM chapas GROUP BY onda ORDER BY onda ASC`);
        res.json({ estoqueTotal: parseInt(total.rows[0].total) || 0, chapas: agrupado.rows });
    } catch (err) { res.status(500).json({ error: "Erro" }); }
});

app.get('/api/resumo-hoje', async (req, res) => {
    try {
        const fila = await pool.query(`SELECT COUNT(*) as total FROM pedidos WHERE status = 'PENDENTE' AND created_at::date = CURRENT_DATE`);
        const caixas = await pool.query(`SELECT COALESCE(SUM(qtd_conferida), 0) as total FROM pedidos WHERE status = 'CONCLUÍDO' AND created_at::date = CURRENT_DATE`);
        res.json({ total_caixas: parseInt(caixas.rows[0].total), fila_pedidos: parseInt(fila.rows[0].total) });
    } catch (err) { res.status(500).json({ total_caixas: 0, fila_pedidos: 0 }); }
});

app.get('/api/dashboard-stats', async (req, res) => {
    try {
        const resChapasTotal = await pool.query('SELECT SUM(quantidade) as total FROM chapas');
        const resChapasHoje = await pool.query(`SELECT SUM(quantidade) as total FROM movimentacoes WHERE tipo = 'ENTRADA' AND data::date = CURRENT_DATE`);
        const resProducaoHoje = await pool.query(`SELECT SUM(quantidade) as total FROM movimentacoes WHERE tipo = 'ENTRADA ESTOQUE' AND data::date = CURRENT_DATE`);
        const resAlertasChapas = await pool.query(`SELECT COUNT(*) as total FROM chapas WHERE quantidade <= 500`);
        const resAlertasCaixas = await pool.query(`SELECT COUNT(*) as total FROM caixas WHERE quantidade <= 100`);
        res.json({
            estoqueChapas: resChapasTotal.rows[0].total || 0,
            chapasRecebidasHoje: resChapasHoje.rows[0].total || 0,
            producaoHoje: resProducaoHoje.rows[0].total || 0,
            alertasCriticosChapas: resAlertasChapas.rows[0].total || 0,
            alertasCriticosCaixas: resAlertasCaixas.rows[0].total || 0
        });
    } catch (error) { res.status(500).json({ error: "Erro" }); }
});


// --- SISTEMA DE CRIPTOGRAFIA DE SENHAS ---
const bcrypt = require('bcrypt');
const saltRounds = 10; 

async function criptografarSenha(senhaPura) {
    return await bcrypt.hash(senhaPura, saltRounds);
}

// --- SISTEMA DE LOGIN E PERFIL ---

app.post('/api/login', async (req, res) => {
    const usuarioDigitado = req.body.usuario ? req.body.usuario.trim() : "";
    const senhaDigitada = req.body.senha ? req.body.senha.trim() : "";

    try {
        // 1. Busca o usuário
        const result = await pool.query('SELECT * FROM usuarios WHERE usuario = $1', [usuarioDigitado]);
        
        const mensagemErro = "Usuário ou senha incorreto! Tente novamente.";

        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: mensagemErro });
        }

        const usuarioBanco = result.rows[0];

        const senhaCorreta = await bcrypt.compare(senhaDigitada, usuarioBanco.senha);

        if (!senhaCorreta) {
            return res.status(401).json({ success: false, message: mensagemErro });
        }

        if (usuarioBanco.status !== 'ATIVO') {
            return res.status(403).json({ success: false, message: "Pendente" });
        }

        res.json({ success: true, nome: usuarioBanco.nome, cargo: usuarioBanco.cargo });
    } catch (err) {
        console.error("Erro no login:", err);
        res.status(500).json({ success: false, message: "Erro interno no servidor" });
    }
});

const nodemailer = require('nodemailer');

let transporter = null;

if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });
}
// - - sistema de registro de usuario - - //
app.post('/api/login/registrar', async (req, res) => {
    const { nome, usuario, senha, cargo } = req.body;
    try {
        const senhaHash = await criptografarSenha(senha);
        
        // 1. Salva no banco de dados
        await pool.query(
            'INSERT INTO usuarios (nome, usuario, senha, cargo, status) VALUES ($1, $2, $3, $4, $5)', 
            [nome, usuario, senhaHash, cargo, 'PENDENTE']
        );

        if (transporter) {
            try {
                await transporter.sendMail({
                    from: `"Sistema J&E" <${process.env.EMAIL_USER}>`,
                    to: process.env.EMAIL_USER,
                    subject: '🚨 Novo Cadastro: Aguardando Aprovação',
                    text: `Novo usuário solicitado:\nNome: ${nome}\nUsuário: ${usuario}\nCargo: ${cargo}`
                });
            } catch (emailErr) {
                console.error("Erro ao enviar e-mail de aviso (usuário salvo mesmo assim):", emailErr);
            }
        }

        res.json({ success: true, message: "Cadastro enviado! Aguarde liberação." });
        
    } catch (err) {
        console.error("Erro ao registrar usuário", err);
        res.status(500).json({ success: false, message: "Erro ao processar cadastro." });
    }
});

app.post('/api/perfil/atualizar-perfil', async (req, res) => {
    const { id, email, senha, tema } = req.body;
    try {
        if (senha) {
            const senhaHash = await criptografarSenha(senha);
            await pool.query('UPDATE usuarios SET email = $1, tema = $2, senha = $3 WHERE id = $4', [email, tema, senhaHash, id]);
        } else {
            await pool.query('UPDATE usuarios SET email = $1, tema = $2 WHERE id = $3', [email, tema, id]);
        }
        res.sendStatus(200);
    } catch (err) { console.error("Erro ao atualizar perfil", err); res.status(500).json({ success: false }); }
});

// --- FORNECEDORES E MOVIMENTAÇÃO ---

app.get('/api/fornecedores', async (req, res) => {
    try {
        const result = await pool.query('SELECT nome FROM fornecedores ORDER BY nome ASC');
        res.json(result.rows);
    } catch (err) { res.json([{ nome: 'Fornecedor A' }]); }
});

app.post('/api/registrar-movimentacao', async (req, res) => {
    const { tipo, produto, quantidade, usuario } = req.body;
    try {
        await pool.query('INSERT INTO movimentacoes (tipo, produto, quantidade, usuario) VALUES ($1, $2, $3, $4)', [tipo, produto, quantidade, usuario]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

app.get('/api/movimentacoes', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM movimentacoes ORDER BY data DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/registrar-entrada', async (req, res) => {
    const { onda, comprimento, largura, fornecedor, quantidade, usuario } = req.body;
    try {
        const check = await pool.query('SELECT id FROM chapas WHERE onda = $1 AND comprimento = $2 AND largura = $3 AND fornecedor = $4', [onda, comprimento, largura, fornecedor]);
        if (check.rows.length > 0) await pool.query('UPDATE chapas SET quantidade = quantidade + $1 WHERE id = $2', [quantidade, check.rows[0].id]);
        else await pool.query('INSERT INTO chapas (onda, comprimento, largura, fornecedor, quantidade) VALUES ($1, $2, $3, $4, $5)', [onda, comprimento, largura, fornecedor, quantidade]);
        await pool.query('INSERT INTO entrada_chapas (usuario, onda, comprimento, largura, fornecedor, quantidade) VALUES ($1, $2, $3, $4, $5, $6)', [usuario, onda, comprimento, largura, fornecedor, quantidade]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

// --- BUSCAR ENTRADAS DO DIA ---
app.get('/api/entrada-chapas-hoje', async (req, res) => {
    try {
        console.log("🔍 Buscando entradas...");
        const result = await pool.query('SELECT * FROM entrada_chapas ORDER BY id DESC');
        console.log("✅ Entradas encontradas:", result.rows.length);
        res.json(result.rows);
    } catch (err) {
        console.error("❌ ERRO CRÍTICO:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- LOGS ADMIN ---
app.get('/api/admin/logs', (req, res) => {
    if (req.query.senha !== "0") return res.status(403).send("⛔ Negado");
    const caminhoLog = path.join(__dirname, 'sistema.log');
    fs.readFile(caminhoLog, 'utf8', (err, data) => {
        if (err) return res.send("Sem logs.");
        res.send(`<pre style="background:#000;color:#0f0;padding:20px;">${data}</pre>`);
    });
});


// --- ROTAS DE SAÍDAS E ENTREGAS ---


// 1. Rota para Registrar a Saída e reduzir estoque
app.post('/api/registrar-carga', async (req, res) => {
    const { caminhao, itens } = req.body;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN'); // Inicia a transação segura

        for (const item of itens) {
            // Buscamos o item no banco usando o código como TEXTO (sem converter para número)
            console.log("Buscando código no banco:", item.codigo);
            const check = await client.query('SELECT quantidade FROM caixas WHERE codigo = $1', [item.codigo]);
            
            if (check.rows.length === 0) {
                throw new Error(`Código ${item.codigo} não encontrado no estoque.`);
            }

            const estoqueAtual = parseInt(check.rows[0].quantidade);
            if (estoqueAtual < item.quantidade) {
                throw new Error(`Estoque insuficiente para ${item.codigo}. Temos apenas ${estoqueAtual}.`);
            }

            // Reduz o estoque
            await client.query('UPDATE caixas SET quantidade = quantidade - $1 WHERE codigo = $2', [item.quantidade, item.codigo]);
        }

        // Insere na tabela de saídas
        await client.query(
            'INSERT INTO saidas (caminhao, carga_json, data_saida, status) VALUES ($1, $2, $3, $4)',
            [caminhao, JSON.stringify(itens), new Date(), 'pendente']
        );

        await client.query('COMMIT');
        res.json({ success: true });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Erro na API de saída:", err.message);
        res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
});

// 2. Rota para Listar as Saídas (usada na sua função carregarTabelaSaidas)
app.get('/api/saidas', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM saidas ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Rota para Registrar Chegada (muda status para concluído)
app.post('/api/finalizar_rota/:id', async (req, res) => {
    try {
        await pool.query(
            'UPDATE saidas SET data_chegada = NOW(), status = $1 WHERE id = $2', 
            ['concluído', req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


app.listen(PORT, () => {
    console.log(`Servidor J&E rodando na porta${PORT}`);
});