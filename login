app.post('/login', async (req, res) => {
    const { usuario, senha } = req.body;
    try {
        const resultado = await pool.query('SELECT * FROM usuarios WHERE usuario = $1 AND senha = $2', [usuario, senha]);
        if (resultado.rows.length > 0) {
            if (resultado.rows[0].status === 'PENDENTE') return res.status(403).json({ success: false, message: "Aguarde liberação." });
            res.json({ success: true, nome: resultado.rows[0].nome, cargo: resultado.rows[0].cargo });
        } else {
            res.status(401).json({ success: false, message: "Dados incorretos!" });
        }
    } catch (err) {
        logger("error", `Erro no login: ${err.message}`);
        res.status(500).json({ success: false, message: "Erro no servidor." });
    }
});