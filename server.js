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

// - - ROTAS DO DASHBOARD - - //
app.get('/dados', async (req, res) => {
    try {
        
        const totalGeral = await pool.query('SELECT SUM(quantidade) as total FROM chapas');

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
}); // - FIM - //

app.get('/resumo-hoje', async (req, res) => {
    try {
        // Usamos ::date para comparar apenas Dia/Mês/Ano
        const fila = await pool.query(`
            SELECT COUNT(*) as total 
            FROM pedidos 
            WHERE status = 'PENDENTE' 
            AND created_at::date = CURRENT_DATE`);
        
        const caixas = await pool.query(`
            SELECT COALESCE(SUM(qtd_conferida), 0) as total 
            FROM pedidos 
            WHERE status = 'CONCLUÍDO' 
            AND created_at::date = CURRENT_DATE`);


        res.json({
            total_caixas: parseInt(caixas.rows[0].total) || 0,
            fila_pedidos: parseInt(fila.rows[0].total) || 0
        });
    } catch (err) {
        console.error("Erro na rota resumo:", err.message);
        res.status(500).json({ total_caixas: 0, fila_pedidos: 0 });
    }
});

// - - ROTAS DE CHAPAS - - //
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
}); // - FIM - //

// --- CONEXAO <--> PRODUÇÃO E EXPEDIÇÃO ---

 app.post('/produzir', async (req, res) => {

    const { cliente, referencia, tipo_onda, largura_chapa, comprimento_chapa, qtd_chapas_necessarias, qtd_programada, medida } = req.body;
    
    try {
        await pool.query('BEGIN');

// - - ATUALIZAR O ESTOQUE DE CHAPAS - - //
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
}); // - FIM - //


// - - PAGINA DE EXPEDICAO - - //

app.get('/pedidos-recentes', async (req, res) => {
    try {
        const query = `
        SELECT * FROM pedidos
        WHERE status = 'PENDENTE'
        OR (status = 'CONCLUÍDO' AND created_at::date = CURRENT_DATE)
        ORDER BY id DESC
        `;
        const resultado = await pool.query(query);
        res.json(resultado.rows);
    } catch (error) {
        console.error("Erro ao buscar pedidos na expedição:", error);
        res.status(500).json({ error: "Erro interno no servidor" });
    }
});

app.post('/conferir-pedido', async (req, res) => {
    const { id, qtd_conferida, responsavel } = req.body;
    console.log(">>> Iniciando conferência para ID:", id);

    try {
        await pool.query('BEGIN');

        // 1. Atualizar Pedido
        const resPedido = await pool.query(
            `UPDATE pedidos SET status = 'CONCLUÍDO', qtd_conferida = $1, responsavel = $2 WHERE id = $3 RETURNING *`,
            [qtd_conferida, responsavel, id]
        );
        console.log("1. Pedido atualizado com sucesso");

        const pedido = resPedido.rows[0];

        // 2. Inserir na tabela Caixas (VERIFIQUE OS NOMES DAS COLUNAS AQUI)
        // Se sua tabela no banco tiver nomes diferentes (ex: 'ref' em vez de 'codigo'), mude aqui.
        await pool.query(
            `INSERT INTO caixas (cliente, codigo, quantidade, data_fabricacao, responsavel) VALUES ($1, $2, $3, NOW(), $4)`,
            [pedido.cliente, pedido.referencia || 'S/ REF', qtd_conferida, responsavel]
        );
        console.log("2. Inserido no estoque de caixas");

        // 3. Movimentação (DICA: Se esta tabela não existir, o erro 500 será aqui!)
        await pool.query(
            `INSERT INTO movimentacoes (tipo, descricao, quantidade, responsavel, data) VALUES ($1, $2, $3, $4, NOW())`,
            ['SAÍDA', `Expedição cliente: ${pedido.cliente}`, qtd_conferida, responsavel]
        );
        console.log("3. Movimentação registrada");

        await pool.query('COMMIT');
        res.json({ success: true });

    } catch (error) {
        if (pool) await pool.query('ROLLBACK');
        
        // ESSE LOG ABAIXO É O MAIS IMPORTANTE:
        console.error("--- ERRO NO SERVIDOR ---");
        console.error("Mensagem:", error.message); 
        console.error("Coluna/Tabela com erro:", error.detail || "Verifique os nomes no SQL");
        console.error("------------------------");
        
        res.status(500).json({ success: false, message: error.message });
    }
}); // - FIM - //


// -- PAGINA DE CHAPAS -- //

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


app.get('/api/chapas', async (req, res) => {
    try {
 
        const result = await pool.query('SELECT * FROM chapas ORDER BY onda ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}); // - FIM - //

// - - BOTAO DE ADICIONAR CHAPAS - - //
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
}); // - FIM - //

// - - BOTAO DE AJUSTAR CHAPAS - - //
app.post('/ajustar-estoque', async (req, res) => {
    const { id, onda, novaQuantidade, novoComprimento, novaLargura, novoFornecedor } = req.body;

    console.log("Dados recebidos para ajuste:", req.body);

    if (!id || !onda) {
        return res.status(400).json({ error: "ID e Onda são obrigatórios" });
    }

    try {
        const query = `
            UPDATE chapas 
            SET onda = $1, 
                quantidade = $2, 
                comprimento = $3, 
                largura = $4, 
                fornecedor = $5 
            WHERE id = $6
        `;
        const values = [
            onda, 
            Number(novaQuantidade), 
            Number(novoComprimento), 
            Number(novaLargura), 
            novoFornecedor, 
            id
        ];
        
        const result = await pool.query(query, values);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Chapa não encontrada" });
        }

        res.status(200).json({ message: "Atualizado com sucesso!" });
    } catch (err) {
        console.error("ERRO NO SQL:", err.message); // Isso vai dizer o erro real no seu terminal
        res.status(500).json({ error: "Erro interno no banco de dados" });
    }
}); // - FIM - //

// - - ROTA PARA FORNECEDORES - - //
app.get('/fornecedores', async (req, res) => {
    try {
        
        const result = await pool.query('SELECT nome FROM fornecedores ORDER BY nome ASC');
        res.json(result.rows);
    } catch (err) {

        res.json([{ nome: 'Fornecedor A' }, { nome: 'Fornecedor B' }]);
    }
}); // - FIM - //

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


// - - AJUSTAR ESTOQUE CAIXAS - - //
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
}); // - FIM - //


// - - ROTA PARA PRODUCAO ( SUBSTITUI {QTD} > CHAPA E ADICIONA {QTD} > CAIXAS) - - //
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

// - - ROTA FUNCIONALIDADE DOS BOTOES DE EDITAR NO CLICK ESQUERDO - - //

app.delete('/api/caixas/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const resultado = await db.query('DELETE FROM caixas WHERE id = $1', [id]);
        
        if (resultado.rowCount > 0) {
            res.json({ success: true, message: "Caixa excluída com sucesso!" });
        } else {
            res.status(404).json({ success: false, message: "Caixa não encontrada." });
        }
    } catch (error) {
        console.error("Erro ao excluir:", error);
        res.status(500).json({ success: false, message: "Erro ao excluir do banco de dados." });
    }
});
// - EDITAR CAIXA - //
app.put('/api/caixas/:id', async (req, res) => {
    const { id } = req.params;
    const { cliente, codigo, quantidade } = req.body;
    try {
        await db.query(
            'UPDATE caixas SET cliente = $1, codigo = $2, quantidade = $3 WHERE id = $4',
            [cliente, codigo, quantidade, id]
        );
        res.json({ success: true, message: "Dados atualizados!" });
    } catch (error) {
        console.error("Erro ao editar:", error);
        res.status(500).json({ success: false, message: "Erro ao atualizar no banco." });
    }
}); // - FIM - //


// - - PAGINA DE LOGIN - - //

app.post('/login', async (req, res) => {
    const { usuario, senha } = req.body;
    console.log("Tentativa de login:", usuario, senha);

    try {
        const resultado = await pool.query(
            'SELECT * FROM usuarios WHERE usuario = $1 AND senha = $2',
            [usuario, senha]
        );

        if (resultado.rows.length > 0) {
            const user = resultado.rows[0];
            res.json({
                success: true,
                nome: user.nome,
                cargo: user.cargo
            });
        } else {
            res.status(401).json({ success: false, message: "Usuário ou senha incorretos!" });
        }
    } catch (err) {
        console.error("Erro no login:", err);
        res.status(500).json({ success: false, message: "Erro ao conectar ao banco de dados." });
    }
});
// - REGISTRO NOVO USUARIO -
app.post('/registrar', async (req, res) => {
    const { nome, usuario, senha } = req.body;

    try {
        // Por padrão, novos usuários entram com cargo 'Operador'
        await pool.query(
            'INSERT INTO usuarios (nome, usuario, senha, cargo) VALUES ($1, $2, $3, $4)',
            [nome, usuario, senha, 'Operador']
        );
        res.json({ success: true, message: "Solicitação enviada com sucesso! Aguarde a liberação." });
    } catch (err) {
        if (err.code === '23505') { // Erro de duplicidade no Postgres
            res.status(400).json({ success: false, message: "Este nome de usuário já está em uso." });
        } else {
            console.error("Erro no registro:", err);
            res.status(500).json({ success: false, message: "Erro ao registrar usuário." });
        }
    }
}); // - FIM - //

// - - PAGINA DE CONFIGURACOES - - //
app.post('/api/atualizar-perfil', async (req, res) => {
    const { id, email, senha, tema } = req.body;
    
    let query = 'UPDATE usuarios SET email = $1, tema = $2';
    let params = [email, tema, id];
    
    if (senha) {
        query = 'UPDATE usuarios SET email = $1, tema = $2, senha = $3 WHERE id = $4';
        params = [email, tema, senha, id];
    } else {
        query = 'UPDATE usuarios SET email = $1, tema = $2 WHERE id = $3';
    }
    
    res.sendStatus(200);
});


app.listen(3000, () => {
    console.log("✅ Servidor J&E rodando na porta 3000 com prefixo public.");
});