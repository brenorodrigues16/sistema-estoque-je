require('dotenv').config();

const express = require('express');

const { Pool } = require('pg');

const cors = require('cors');

const fs = require('fs');

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



        logger("info", `Ondas encontradas e formatadas: ${JSON.stringify(formatado)}`);

        res.json(formatado);

    } catch (err) {

        logger("error", `ERRO NA TABELA CHAPAS: ${err.message}`);

        res.status(500).json([]);

    }

});



// - - SISTEMA AVANÇADO DE LOGS - - //

function logger(tipo, mensagem) {

    const dataHora = new Date().toLocaleString('pt-BR');



    const tipoSeguro = String(tipo || "INFO").toUpperCase();

    const logFormatado = `[${dataHora}] [${tipoSeguro}] ${mensagem}\n`;

   

    console.log(logFormatado.trim());

   

    const caminhoLog = path.join(__dirname, 'sistema.log');

   

    fs.appendFile(caminhoLog, logFormatado, (err) => {

        if (err) console.error("falha ao salvar log:", err);

    });

} // - FIM - //



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

        logger("error", `Erro na rota /dados: ${err.message}`);

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

        logger("error", `Erro na rota resumo: ${err.message}`);

        res.status(500).json({ total_caixas: 0, fila_pedidos: 0 });

    }

});



// - - ROTAS DE CHAPAS - - //

app.get('/api/chapas', async (req, res) => {

    try {

        const result = await pool.query('SELECT * FROM chapas ORDER BY onda ASC');

        res.json(result.rows);

    } catch (err) {

        logger("error", `Erro ao buscar chapas: ${err.message}`);

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

        logger("error", `Erro ao inserir: ${err.message}`);

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

        logger("error", `Erro na produção: ${err.message}`);

        if (pool) await pool.query('ROLLBACK');

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

        logger("error", `Erro ao buscar pedidos na expedição: ${error.message}`);

        res.status(500).json({ error: "Erro interno no servidor" });

    }

});



app.post('/conferir-pedido', async (req, res) => {

    const { id, qtd_conferida, responsavel } = req.body;

    logger("info", `>>> Iniciando conferência para ID: ${id}`);



    try {

        await pool.query('BEGIN');



 

        const resPedido = await pool.query(

            `UPDATE pedidos SET status = 'CONCLUÍDO', qtd_conferida = $1, responsavel = $2 WHERE id = $3 RETURNING *`,

            [qtd_conferida, responsavel, id]

        );



        if (resPedido.rows.length === 0) throw new Error("pedido não encontrado");

        const pedido = resPedido.rows[0];

        const referencia = pedido.referencia || 'S/ REF';



       

        const sqlEstoque = `

            INSERT INTO caixas (cliente, codigo, quantidade, data_fabricacao, responsavel)

            VALUES ($1, $2, $3, NOW(), $4)

            ON CONFLICT (cliente, codigo)

            DO UPDATE SET

                quantidade = caixas.quantidade + EXCLUDED.quantidade,

                data_fabricacao = NOW(),

                responsavel = EXCLUDED.responsavel

        `;



        await pool.query(sqlEstoque, [

            pedido.cliente,

            referencia,

            qtd_conferida,

            responsavel

        ]);

        logger("SUCESSO", `2. Estoque atualizado: ${referencia} para ${pedido.cliente}`);



   

        await pool.query(

            `INSERT INTO movimentacoes (tipo, descricao, quantidade, responsavel, data) VALUES ($1, $2, $3, $4, NOW())`,

            ['ENTRADA ESTOQUE', `Produção concluída: ${referencia} - ${pedido.cliente}`, qtd_conferida, responsavel]

        );

        logger("SUCESSO", "3. Movimentação registrada");



        await pool.query('COMMIT');

        res.json({ success: true });



    } catch (error) {

        if (pool) await pool.query('ROLLBACK');

        logger("error", "--- ERRO NO SERVIDOR ---");

        logger("error", `Mensagem: ${error.message}`);

        logger("error",("-------------------------"));

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

        logger("error", `Erro ao adicionar chapa: ${err.message}`);

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

        logger("error", `Erro ao adicionar chapa: ${err.message}`);

        res.status(500).json({ success: false, message: err.message });

    }

}); // - FIM - //



// - - BOTAO DE AJUSTAR CHAPAS - - //

app.post('/ajustar-estoque', async (req, res) => {

    const { id, onda, novaQuantidade, novoComprimento, novaLargura, novoFornecedor } = req.body;



    logger("info", `Dados recebidos para ajuste: ${JSON.stringify(req.body)}`);



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

        logger("error", `ERRO NO SQL: ${err.message}`); // Isso vai dizer o erro real no seu terminal

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

        logger("error", `Erro ao adicionar caixa: ${err.message}`);

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

    console.log("Recebendo edição:", req.body);

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

       const result = await pool.query(query, values);

       if (result.rowCount === 0) {
        return res.status(400).json({ success: false, message: "Caixa não encontrada"});
       }

        res.json({ success: true });
    } catch (err) {
        logger("error", `Erro no servidor: ${err.message}`);
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

        logger("error", `Erro na produção: ${err.message}`);

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

        logger("error", `Erro ao excluir: ${error.message}`);

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

        logger("error", `Erro ao editar: ${error.message}`);

        res.status(500).json({ success: false, message: "Erro ao atualizar no banco." });

    }

}); // - FIM - //


// - - PAGINA DE LOGIN (server.js) - - //
app.post('/login', async (req, res) => {
    const { usuario, senha } = req.body;
    logger("info", `Tentativa de login: ${usuario}`);

    try {
        const resultado = await pool.query('SELECT * FROM usuarios WHERE usuario = $1', [usuario]);

        if (resultado.rows.length === 0) {
            return res.status(401).json({ success: false, message: "Usuário não encontrado!"});
        }

        const user = resultado.rows[0];

        // Compara as senhas como texto
        if (String(user.senha).trim() !== String(senha).trim()) {
            return res.status(401).json({ success: false, message: "Senha incorreta!" });
        }

        if (user.status !== 'ATIVO') {
            return res.status(403).json({
                success: false,
                message: "Seu cadastro está em análise. Aguarde a liberação do administrador."
            });
        }

        // Retorna o cargo usando a coluna 'carga' do seu banco
        res.json({
            success: true,
            nome: user.nome,
            cargo: user.cargo
        });

    } catch (err) {
        logger("error", `Erro no login: ${err.message}`);
        res.status(500).json({ success: false, message: "Erro ao conectar ao banco de dados." });
    }
});



// - REGISTRO NOVO USUARIO -

app.post('/registrar', async (req, res) => {

    const { nome, usuario, senha } = req.body;



    try {

        // Inserimos o usuário com o cargo 'Operador' e o status 'PENDENTE'

        await pool.query(

            'INSERT INTO usuarios (nome, usuario, senha, cargo, status) VALUES ($1, $2, $3, $4, $5)',

            [nome, usuario, senha, 'Operador', 'PENDENTE']

        );



        // Retorna mensagem de sucesso informando sobre a análise

        res.json({

            success: true,

            message: "Solicitação enviada com sucesso! Seu acesso será liberado em breve pelo administrador."

        });



    } catch (err) {

        if (err.code === '23505') { // Erro de duplicidade (Unique Key) no Postgres

            res.status(400).json({ success: false, message: "Este nome de usuário já está em uso." });

        } else {

            logger("error", `Erro no registro: ${err.message}`);

            res.status(500).json({ success: false, message: "Erro ao registrar usuário." });

        }

    }

});// - FIM - //



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

}); // - FIM - //





// - - ROTA ESTATICAS DO DASHBOARD - - //

app.get('/dashboard-stats', async (req, res) => {

    try {

        const resChapasTotal = await pool.query('SELECT SUM(quantidade) as total FROM chapas');

       

        const resChapasHoje = await pool.query(`

            SELECT SUM(quantidade) as total

            FROM movimentacoes

            WHERE tipo = 'ENTRADA'

            AND data::date = CURRENT_DATE

        `);



        const resProducaoHoje = await pool.query(`

            SELECT SUM(quantidade) as total

            FROM movimentacoes

            WHERE tipo = 'ENTRADA ESTOQUE'

            AND data::date = CURRENT_DATE

        `);



        const resAlertasChapas = await pool.query(`

            SELECT COUNT(*) as total FROM chapas WHERE quantidade <= 500

        `);



        const resAlertasCaixas = await pool.query(`

            SELECT COUNT(*) as total FROM caixas WHERE quantidade <= 100

        `);



        res.json({

            estoqueChapas: resChapasTotal.rows[0].total || 0,

            chapasRecebidasHoje: resChapasHoje.rows[0].total || 0,

            producaoHoje: resProducaoHoje.rows[0].total || 0,

            alertasCriticosChapas: resAlertasChapas.rows[0].total || 0,

            alertasCriticosCaixas: resAlertasCaixas.rows[0].total || 0

        });

    } catch (error) {

        logger("error", `Erro nas estatísticas: ${error.message}`);

        res.status(500).json({ error: "Erro ao buscar dados" });

    }

}); // - FIM - //



// - - ROTA PARA EXIBIR LOGS EM TELA - - //

app.get('/admin/logs', (req, res) => {



    // - - CADEADO SIMPLES PARA PROTEGER A ROTA DE LOGS - - //

    const senhaDigitada = req.query.senha;

    if (senhaDigitada !== "fevereiro16") {

        return res.status(403).send("<h2 style='color: red; text-align: center; font-family: sans-serif; margin-top: 50px;'>⛔ Acesso Bloqueado</h2>");

    } // - FIM - //



    const caminhoLog = path.join(__dirname, 'sistema.log');



    fs.readFile(caminhoLog, 'utf8', (err, data) => {

        if (err) {

            return res.send("Nenhum log encontrado ainda ou erro ao ler o arquivo.");

        }



        res.send(`

            <html>

                <head>

                    <title>J&E - Terminal de Logs</title>

                    <style>

                        body { background-color: #0d1117; color: #58a6ff; font-family: 'Courier New', Courier, monospace; padding: 20px; }

                        h2 { color: #c9d1d9; border-bottom: 1px solid #30363d; padding-bottom: 10px; }

                        .log-container { background: #161b22; padding: 15px; border-radius: 8px; border: 1px solid #30363d; overflow-x: auto; }

                        .btn { background: #238636; color: white; border: none; padding: 10px 15px; cursor: pointer; border-radius: 5px; margin-bottom: 15px; font-weight: bold; }

                        .btn:hover { background: #2ea043; }

                    </style>

                </head>

                <body>

                    <h2>🚨 Central de Monitoramento J&E</h2>

                    <button class="btn" onclick="location.reload()">🔄 Atualizar Terminal</button>

                    <div class="log-container">

                        <pre>${data}</pre>

                    </div>

                </body>

            </html>

        `);

    });

}); // - FIM - //

// - -  ROTA PARA EXIBIR TIPOS DE ONDA - - //
app.get('/tipos_onda', async (req, res) => {
    try {
        const result = await pool.query('SELECT DISTINCT onda FROM chapas');
        res.json(result.rows);
    } catch (err) {
        console.error('Erro ao buscar ondas:', err);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

app.get('/verificar-estoque', async (req, res) => {
    const { tipo, largura, comprimento } = req.query;
    try {
        const result = await pool.query(
            'SELECT quantidade FROM chapas WHERE TRIM(UPPER(onda)) = TRIM(UPPER($1)) AND largura = $2 AND comprimento = $3 LIMIT 1',
            [tipo, largura, comprimento]
        );
        res.json({ estoque: result.rows.length > 0 ? result.rows[0].quantidade : 0 });
    } catch (err) {
        res.status(500).json({ estoque: 0 });
    }
}); // - FIM - //


// - - ROTA PARA REGISTRAR MOVIMENTAÇÃO DE ESTOQUE (ENTRADA/SAÍDA) - - //
app.post('/api/registrar-movimentacao', async (req, res) => {
    const { tipo, produto, quantidade, usuario } = req.body;
    try {
        await pool.query(
            'INSERT INTO movimentacoes (tipo, produto, quantidade, usuario) VALUES ($1, $2, $3, $4)',
            [tipo, produto, quantidade, usuario]
        );
        res.json({ success: true });
    } catch (err) {
        console.error("Erro ao registrar movimentação:", err);
        res.status(500).json({ error: 'Erro ao salvar movimento' });
    }
});// - FIM -//

// - - ROTA PARA EXIBIR EM MOVIMENTAÇÕES - - //
app.get('/api/movimentacoes', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM movimentacoes ORDER BY data DESC');
        
        res.json(result.rows);
    } catch (err) {
        console.error("ERRO DETALHADO NO SERVIDOR:", err);
        res.status(500).json({ error: err.message });
    }
});

// - - ROTA PARA REGISTRAR ENTRADA DE CHAPAS E ATUALIZAR ESTOQUE - - //
app.post('/api/registrar-entrada', async (req, res) => {

    console.log("DADOS RECEBIDOS:", req.body); 
    
    const { onda, comprimento, largura, fornecedor, quantidade, usuario } = req.body;

    try {
        // Tentar encontrar se essa chapa já existe no estoque
        const check = await pool.query(
            'SELECT id, quantidade FROM chapas WHERE onda = $1 AND comprimento = $2 AND largura = $3 AND fornecedor = $4',
            [onda, comprimento, largura, fornecedor]
        );

        if (check.rows.length > 0) {
            // Se existe, soma a quantidade (Atualiza)
            await pool.query(
                'UPDATE chapas SET quantidade = quantidade + $1 WHERE id = $2',
                [quantidade, check.rows[0].id]
            );
        } else {
            // Se não existe, insere uma nova chapa
            await pool.query(
                'INSERT INTO chapas (onda, comprimento, largura, fornecedor, quantidade) VALUES ($1, $2, $3, $4, $5)',
                [onda, comprimento, largura, fornecedor, quantidade]
            );
        }

        // 2. Registra o histórico na nova tabela 'entrada_chapas' que você criou
        await pool.query(
            'INSERT INTO entrada_chapas (usuario, onda, comprimento, largura, fornecedor, quantidade) VALUES ($1, $2, $3, $4, $5, $6)',
            [usuario, onda, comprimento, largura, fornecedor, quantidade]
        );

        // 3. Registra na tabela de movimentações para o histórico geral
        await pool.query(
            'INSERT INTO movimentacoes (tipo, descricao, usuario, data) VALUES ($1, $2, $3, NOW())',
            ['Entrada', `Recebimento de ${quantidade} chapas ${onda} - ${fornecedor}`, usuario]
        );

        res.json({ success: true, message: "Entrada registrada com sucesso!" });
    } catch (err) {
        console.error("ERRO NO REGISTRO:", err);
        res.status(500).json({ success: false, message: "Erro ao registrar no banco." });
    }
});

app.listen(3000, () => {
    logger("info", "✅ Servidor J&E rodando na porta 3000 com prefixo public.");
});